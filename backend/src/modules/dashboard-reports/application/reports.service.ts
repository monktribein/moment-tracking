import { BadRequestException, Injectable } from "@nestjs/common";
import { toCsv } from "../../../common/eco/csv";
import { Where } from "../../../common/eco/pagination";
import { SqlService, type Row } from "../../../database/sql/sql.service";
import type { Principal } from "../../rbac/domain/principal";
import type { ReportQueryDto } from "../presentation/reports.dto";

export const CSV_ROW_LIMIT = 10_000;

interface ReportDef {
  select: string;
  from: string;
  sorts: Record<string, string>;
  filter: (where: Where, q: ReportQueryDto, actor: Principal) => void;
  columns: string[];
}

const dateRange = (where: Where, column: string, q: ReportQueryDto, kind: "timestamp" | "day" = "timestamp") => {
  if (kind === "day") where.eq(`${column} >= ?`, q.from).eq(`${column} <= ?`, q.to);
  else where.eq(`${column} >= (?::date)::timestamptz`, q.from).eq(`${column} < ((?::date) + 1)::timestamptz`, q.to);
};

/** Each report section: its columns, filters and sort keys. Company scoping is always applied first. */
const REPORTS: Record<string, Record<string, ReportDef>> = {
  sales: {
    visits: {
      select: "v.visit_date, d.distributor_code, d.firm_name AS distributor, e.employee_code, e.name AS employee, v.purpose, v.priority, v.status, v.checkin_at, v.checkin_lat, v.checkin_lng, r.next_followup_date",
      from: "leads.sales_visits v JOIN leads.distributors d ON d.id = v.distributor_id JOIN leads.employees e ON e.id = v.employee_id LEFT JOIN leads.visit_reports r ON r.visit_id = v.id",
      sorts: { date: "v.visit_date", status: "v.status", employee: "e.name" },
      filter: (w, q) => {
        w.eq("v.status = ?", q.status).eq("v.employee_id = ?", q.employeeId).eq("v.distributor_id = ?", q.distributorId);
        dateRange(w, "v.visit_date", q, "day");
        w.search(["d.firm_name", "e.name"], q.search);
      },
      columns: ["visitDate", "distributorCode", "distributor", "employeeCode", "employee", "purpose", "priority", "status", "checkinAt", "checkinLat", "checkinLng", "nextFollowupDate"],
    },
    calls: {
      select: "c.called_at, d.distributor_code, d.firm_name AS distributor, e.employee_code, e.name AS employee, c.direction, c.outcome, c.notes, c.next_followup_date",
      from: "leads.call_logs c JOIN leads.distributors d ON d.id = c.distributor_id JOIN leads.employees e ON e.id = c.employee_id",
      sorts: { date: "c.called_at", employee: "e.name" },
      filter: (w, q) => {
        w.eq("c.employee_id = ?", q.employeeId).eq("c.distributor_id = ?", q.distributorId);
        dateRange(w, "c.called_at", q);
        w.search(["d.firm_name", "e.name", "c.notes"], q.search);
      },
      columns: ["calledAt", "distributorCode", "distributor", "employeeCode", "employee", "direction", "outcome", "notes", "nextFollowupDate"],
    },
    followups: {
      select: "f.due_date, d.distributor_code, d.firm_name AS distributor, e.employee_code, e.name AS employee, f.source, f.status, f.notes, f.completed_at",
      from: "leads.followups f JOIN leads.distributors d ON d.id = f.distributor_id JOIN leads.employees e ON e.id = f.employee_id",
      sorts: { date: "f.due_date", status: "f.status" },
      filter: (w, q) => {
        w.eq("f.status = ?", q.status).eq("f.employee_id = ?", q.employeeId).eq("f.distributor_id = ?", q.distributorId);
        dateRange(w, "f.due_date", q, "day");
        w.search(["d.firm_name", "e.name"], q.search);
      },
      columns: ["dueDate", "distributorCode", "distributor", "employeeCode", "employee", "source", "status", "notes", "completedAt"],
    },
    distributors: {
      select: "d.distributor_code, d.firm_name, d.contact_person, d.mobile, d.city, d.state, e.name AS executive, d.is_active, d.portal_access, (SELECT count(*)::int FROM leads.sales_visits v WHERE v.distributor_id = d.id) AS visits, (SELECT count(*)::int FROM leads.purchase_requests r WHERE r.distributor_id = d.id) AS purchase_requests",
      from: "leads.distributors d LEFT JOIN leads.employees e ON e.id = d.assigned_executive_id",
      sorts: { name: "d.firm_name", code: "d.distributor_code" },
      filter: (w, q) => {
        w.eq("d.assigned_executive_id = ?", q.employeeId).eq("d.id = ?", q.distributorId);
        w.search(["d.firm_name", "d.mobile", "d.city"], q.search);
      },
      columns: ["distributorCode", "firmName", "contactPerson", "mobile", "city", "state", "executive", "isActive", "portalAccess", "visits", "purchaseRequests"],
    },
  },
  purchases: {
    requests: {
      select: "r.request_no, r.created_at, d.distributor_code, d.firm_name AS distributor, r.source, u.name AS created_by, r.status, r.payment_status, r.version, r.external_invoice_ref, r.approved_at, r.processed_at, (SELECT coalesce(sum(i.quantity), 0)::int FROM leads.purchase_request_items i WHERE i.request_id = r.id) AS total_quantity",
      from: "leads.purchase_requests r JOIN leads.distributors d ON d.id = r.distributor_id LEFT JOIN leads.lead_users u ON u.id = r.creator_user_id",
      sorts: { date: "r.created_at", status: "r.status", requestNo: "r.request_no" },
      filter: (w, q) => {
        w.eq("r.status = ?", q.status).eq("r.distributor_id = ?", q.distributorId).eq("r.source = ?", q.source).eq("r.creator_user_id = ?", q.userId);
        if (q.origin === "distributor") w.raw("r.source = 'portal'");
        if (q.origin === "employee") w.raw("r.source <> 'portal'");
        dateRange(w, "r.created_at", q);
        w.search(["r.request_no", "d.firm_name"], q.search);
      },
      columns: ["requestNo", "createdAt", "distributorCode", "distributor", "source", "createdBy", "status", "paymentStatus", "version", "externalInvoiceRef", "approvedAt", "processedAt", "totalQuantity"],
    },
    payments: {
      select: "p.created_at, r.request_no, d.firm_name AS distributor, p.amount, p.method, p.payment_date, p.utr_normalized, p.status, p.is_active, rv.name AS reviewer, p.reviewed_at, p.rejection_reason",
      from: "leads.purchase_payments p JOIN leads.purchase_requests r ON r.id = p.request_id JOIN leads.distributors d ON d.id = r.distributor_id LEFT JOIN leads.lead_users rv ON rv.id = p.reviewer_id",
      sorts: { date: "p.created_at", status: "p.status", amount: "p.amount" },
      filter: (w, q) => {
        w.eq("p.status = ?", q.status).eq("r.distributor_id = ?", q.distributorId);
        dateRange(w, "p.created_at", q);
        w.search(["r.request_no", "d.firm_name", "p.utr_normalized"], q.search);
      },
      columns: ["createdAt", "requestNo", "distributor", "amount", "method", "paymentDate", "utrNormalized", "status", "isActive", "reviewer", "reviewedAt", "rejectionReason"],
    },
  },
  service: {
    complaints: {
      select: "c.complaint_no, c.created_at, cu.name AS customer, cp.model, cp.serial_no, c.category, c.status, en.name AS engineer, c.reopen_count, c.resolved_at, c.closed_at",
      from: "leads.complaints c JOIN leads.customers cu ON cu.id = c.customer_id JOIN leads.customer_products cp ON cp.id = c.customer_product_id LEFT JOIN leads.complaint_assignments a ON a.complaint_id = c.id AND a.is_current LEFT JOIN leads.employees en ON en.id = a.engineer_id",
      sorts: { date: "c.created_at", status: "c.status" },
      filter: (w, q) => {
        w.eq("c.status = ?", q.status).eq("a.engineer_id = ?", q.employeeId);
        dateRange(w, "c.created_at", q);
        w.search(["c.complaint_no", "cu.name", "cp.serial_no"], q.search);
      },
      columns: ["complaintNo", "createdAt", "customer", "model", "serialNo", "category", "status", "engineer", "reopenCount", "resolvedAt", "closedAt"],
    },
    engineers: {
      select: `e.employee_code, e.name AS engineer,
        (SELECT count(*)::int FROM leads.complaint_assignments a WHERE a.engineer_id = e.id) AS assigned_total,
        (SELECT count(*)::int FROM leads.complaint_assignments a JOIN leads.complaints k ON k.id = a.complaint_id WHERE a.engineer_id = e.id AND a.is_current AND k.status IN ('assigned','in_progress','pending')) AS active_jobs,
        (SELECT count(*)::int FROM leads.service_reports r WHERE r.engineer_id = e.id) AS reports_filed,
        (SELECT count(*)::int FROM leads.service_visits v WHERE v.engineer_id = e.id AND v.status = 'completed') AS visits_completed,
        (SELECT round(avg(extract(epoch FROM (k.closed_at - k.created_at)) / 3600)::numeric, 1)::float FROM leads.complaint_assignments a JOIN leads.complaints k ON k.id = a.complaint_id WHERE a.engineer_id = e.id AND k.closed_at IS NOT NULL) AS avg_hours_to_close`,
      from: "leads.employees e JOIN leads.roles r ON r.id = e.role_id",
      sorts: { name: "e.name" },
      filter: (w, q) => {
        w.raw("r.code = 'field_support'").eq("e.id = ?", q.employeeId);
        w.search(["e.name", "e.employee_code"], q.search);
      },
      columns: ["employeeCode", "engineer", "assignedTotal", "activeJobs", "reportsFiled", "visitsCompleted", "avgHoursToClose"],
    },
  },
  hr: {
    attendance: {
      select: "a.date, e.employee_code, a.agent_name AS employee, a.check_in_time, a.check_out_time, a.total_working_minutes, a.formatted_working_hours, a.status, a.notes",
      from: "leads.lead_attendances a JOIN leads.employees e ON e.user_id = a.agent_id AND e.company_id = a.company_id",
      sorts: { date: "a.date", employee: "a.agent_name" },
      filter: (w, q) => {
        w.eq("e.id = ?", q.employeeId).eq("a.status = ?", q.status);
        dateRange(w, "a.date", q, "day");
        w.search(["a.agent_name", "e.employee_code"], q.search);
      },
      columns: ["date", "employeeCode", "employee", "checkInTime", "checkOutTime", "totalWorkingMinutes", "formattedWorkingHours", "status", "notes"],
    },
    expenses: {
      select: "x.expense_date, e.employee_code, e.name AS employee, x.category, x.amount, x.description, x.status, x.rejection_reason, x.reimbursed_at, x.reimbursement_ref",
      from: "leads.expenses x JOIN leads.employees e ON e.id = x.employee_id",
      sorts: { date: "x.expense_date", amount: "x.amount", status: "x.status" },
      filter: (w, q) => {
        w.eq("x.status = ?", q.status).eq("x.employee_id = ?", q.employeeId);
        dateRange(w, "x.expense_date", q, "day");
        w.search(["e.name", "x.category"], q.search);
      },
      columns: ["expenseDate", "employeeCode", "employee", "category", "amount", "description", "status", "rejectionReason", "reimbursedAt", "reimbursementRef"],
    },
    leaves: {
      select: "l.from_date, l.to_date, e.employee_code, e.name AS employee, l.leave_type, l.reason, l.status, l.decided_at, l.decision_note",
      from: "leads.leaves l JOIN leads.employees e ON e.id = l.employee_id",
      sorts: { date: "l.from_date", status: "l.status" },
      filter: (w, q) => {
        w.eq("l.status = ?", q.status).eq("l.employee_id = ?", q.employeeId).eq("l.to_date >= ?", q.from).eq("l.from_date <= ?", q.to);
        w.search(["e.name", "l.reason"], q.search);
      },
      columns: ["fromDate", "toDate", "employeeCode", "employee", "leaveType", "reason", "status", "decidedAt", "decisionNote"],
    },
    payroll: {
      select: "p.month, e.employee_code, e.name AS employee, p.fixed_salary, p.calc_days, p.payable_days, p.unpaid_leave_days, p.adjustments, p.adjustment_note, p.net_payable, p.status, p.finalized_at",
      from: "leads.payroll p JOIN leads.employees e ON e.id = p.employee_id",
      sorts: { month: "p.month", employee: "e.name" },
      filter: (w, q) => {
        w.eq("p.status = ?", q.status).eq("p.employee_id = ?", q.employeeId).eq("p.month >= ?", q.from?.slice(0, 7)).eq("p.month <= ?", q.to?.slice(0, 7));
        w.search(["e.name", "e.employee_code"], q.search);
      },
      columns: ["month", "employeeCode", "employee", "fixedSalary", "calcDays", "payableDays", "unpaidLeaveDays", "adjustments", "adjustmentNote", "netPayable", "status", "finalizedAt"],
    },
  },
};

export const REPORT_SECTIONS: Record<string, string[]> = Object.fromEntries(Object.entries(REPORTS).map(([k, v]) => [k, Object.keys(v)]));

@Injectable()
export class ReportsService {
  constructor(private readonly sql: SqlService) {}

  /** The company filter is applied to whichever table the section is built on (its first alias). */
  private companyColumn(section: string, name: string): string {
    const key = `${section}.${name}`;
    const alias: Record<string, string> = {
      "sales.visits": "v", "sales.calls": "c", "sales.followups": "f", "sales.distributors": "d", "purchases.requests": "r", "purchases.payments": "p", "service.complaints": "c", "service.engineers": "e",
      "hr.attendance": "a", "hr.expenses": "x", "hr.leaves": "l", "hr.payroll": "p",
    };
    return `${alias[key]}.company_id`;
  }

  async run(actor: Principal, section: string, query: ReportQueryDto, csv: boolean) {
    const name = query.section ?? Object.keys(REPORTS[section])[0];
    const def = REPORTS[section]?.[name];
    if (!def) throw new BadRequestException(`Unknown ${section} report "${name}". Available: ${REPORT_SECTIONS[section].join(", ")}`);
    if (query.from && query.to && query.from > query.to) throw new BadRequestException("from is after to");
    const where = new Where().eq(`${this.companyColumn(section, name)} = ?`, actor.companyId);
    def.filter(where, query, actor);
    const keys = Object.keys(def.sorts);
    const sort = def.sorts[query.sort ?? ""] ?? def.sorts[keys[0]];
    const order = (query.order ?? "desc") === "asc" ? "ASC" : "DESC";
    const total = (await this.sql.one<{ n: number }>(`SELECT count(*)::int AS n FROM ${def.from} ${where.sql}`, where.params))?.n ?? 0;
    const page = csv ? 1 : (query.page ?? 1);
    const limit = csv ? CSV_ROW_LIMIT : (query.limit ?? 50);
    const rows: Row[] = await this.sql.all(`SELECT ${def.select} FROM ${def.from} ${where.sql} ORDER BY ${sort} ${order} LIMIT ${limit} OFFSET ${(page - 1) * limit}`, where.params);
    return { section: name, columns: def.columns, rows, page, limit, total, truncated: csv && total > CSV_ROW_LIMIT };
  }

  csv(result: { rows: Row[]; columns: string[] }): string {
    return toCsv(result.rows, result.columns);
  }
}
