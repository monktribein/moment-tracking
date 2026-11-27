import { ForbiddenException, Injectable } from "@nestjs/common";
import { addDays, todayIst } from "../../../common/eco/http";
import { SqlService } from "../../../database/sql/sql.service";
import type { Principal } from "../../rbac/domain/principal";
import { adminExtras, hrExtras, salesManagerExtras, supportExtras, teleSalesExtras } from "./dashboard-extras";

const counts = (rows: { key: string; n: number }[]): Record<string, number> => Object.fromEntries(rows.map((r) => [r.key, r.n]));

/** Dashboards: every number is a live count from the database for the caller's company (and, for staff, their own work). */
@Injectable()
export class DashboardService {
  constructor(private readonly sql: SqlService) {}

  private grouped(table: string, column: string, companyId: string, extra = "", params: unknown[] = []) {
    return this.sql.all<{ key: string; n: number }>(`SELECT ${column} AS key, count(*)::int AS n FROM leads.${table} WHERE company_id = $1 ${extra} GROUP BY ${column}`, [companyId, ...params]).then(counts);
  }

  private n(sql: string, params: unknown[]): Promise<number> {
    return this.sql.one<{ n: number }>(sql, params).then((r) => r?.n ?? 0);
  }

  async admin(actor: Principal) {
    const c = actor.companyId;
    const today = todayIst();
    const month = today.slice(0, 7);
    const [employees, distributors, products, requestsByStatus, paymentsToVerify, complaintsByStatus, presentToday, pendingExpenses, pendingLeaves, payrollByStatus, visitsToday, overdueFollowups] = await Promise.all([
      this.n(`SELECT count(*)::int AS n FROM leads.employees WHERE company_id = $1 AND is_active`, [c]),
      this.n(`SELECT count(*)::int AS n FROM leads.distributors WHERE company_id = $1 AND is_active`, [c]),
      this.n(`SELECT count(*)::int AS n FROM leads.products WHERE company_id = $1 AND is_active`, [c]),
      this.grouped("purchase_requests", "status", c),
      this.n(`SELECT count(*)::int AS n FROM leads.purchase_payments p JOIN leads.purchase_requests r ON r.id = p.request_id WHERE p.company_id = $1 AND p.is_active AND p.status = 'pending' AND r.status IN ('submitted','under_review')`, [c]),
      this.grouped("complaints", "status", c),
      this.n(`SELECT count(*)::int AS n FROM leads.lead_attendances a JOIN leads.employees e ON e.user_id = a.agent_id WHERE e.company_id = $1 AND a.date = $2 AND a.checked_in`, [c, today]),
      this.n(`SELECT count(*)::int AS n FROM leads.expenses WHERE company_id = $1 AND status = 'submitted'`, [c]),
      this.n(`SELECT count(*)::int AS n FROM leads.leaves WHERE company_id = $1 AND status = 'pending'`, [c]),
      this.grouped("payroll", "status", c, "AND month = $2", [month]),
      this.n(`SELECT count(*)::int AS n FROM leads.sales_visits WHERE company_id = $1 AND visit_date = $2 AND status <> 'cancelled'`, [c, today]),
      this.n(`SELECT count(*)::int AS n FROM leads.followups WHERE company_id = $1 AND status = 'pending' AND due_date < $2`, [c, today]),
    ]);
    return { ...(await adminExtras(this.sql, c, today)), date: today, employees, distributors, products, purchaseRequests: requestsByStatus, paymentsAwaitingVerification: paymentsToVerify, complaints: complaintsByStatus, presentToday, pendingExpenses, pendingLeaves, payroll: { month, byStatus: payrollByStatus }, visitsToday, overdueFollowups };
  }

  async salesManager(actor: Principal) {
    const c = actor.companyId;
    const today = todayIst();
    const weekAgo = addDays(today, -7);
    const [visitsByStatus, visitsToday, overdueFollowups, pendingFollowups, calls7d, toReview, assigned, perExecutive] = await Promise.all([
      this.grouped("sales_visits", "status", c, "AND visit_date >= $2", [weekAgo]),
      this.n(`SELECT count(*)::int AS n FROM leads.sales_visits WHERE company_id = $1 AND visit_date = $2 AND status <> 'cancelled'`, [c, today]),
      this.n(`SELECT count(*)::int AS n FROM leads.followups WHERE company_id = $1 AND status = 'pending' AND due_date < $2`, [c, today]),
      this.n(`SELECT count(*)::int AS n FROM leads.followups WHERE company_id = $1 AND status = 'pending'`, [c]),
      this.n(`SELECT count(*)::int AS n FROM leads.call_logs WHERE company_id = $1 AND called_at >= now() - interval '7 days'`, [c]),
      this.n(`SELECT count(*)::int AS n FROM leads.purchase_requests WHERE company_id = $1 AND status IN ('submitted','under_review')`, [c]),
      this.n(`SELECT count(*)::int AS n FROM leads.distributors WHERE company_id = $1 AND is_active AND assigned_executive_id IS NOT NULL`, [c]),
      this.sql.all(
        `SELECT e.id AS employee_id, e.name, (SELECT count(*)::int FROM leads.distributors d WHERE d.assigned_executive_id = e.id AND d.is_active) AS distributors,
                (SELECT count(*)::int FROM leads.sales_visits v WHERE v.employee_id = e.id AND v.visit_date >= $2) AS visits_last_7_days,
                (SELECT count(*)::int FROM leads.followups f WHERE f.employee_id = e.id AND f.status = 'pending' AND f.due_date < $3) AS overdue_followups
           FROM leads.employees e JOIN leads.roles r ON r.id = e.role_id WHERE e.company_id = $1 AND e.is_active AND r.code IN ('tele_sales','field_sales') ORDER BY e.name`,
        [c, weekAgo, today],
      ),
    ]);
    return { ...(await salesManagerExtras(this.sql, c, today)), date: today, visitsLast7Days: visitsByStatus, visitsToday, overdueFollowups, pendingFollowups, callsLast7Days: calls7d, purchaseRequestsToReview: toReview, assignedDistributors: assigned, team: perExecutive };
  }

  async teleSales(actor: Principal) {
    if (!actor.employeeId) throw new ForbiddenException("This dashboard is for employee accounts");
    const me = actor.employeeId;
    const today = todayIst();
    const [distributors, visitsToday, followupsDue, overdue, callsToday, requests] = await Promise.all([
      this.n(`SELECT count(*)::int AS n FROM leads.distributors WHERE assigned_executive_id = $1 AND is_active`, [me]),
      this.n(`SELECT count(*)::int AS n FROM leads.sales_visits WHERE employee_id = $1 AND visit_date = $2 AND status IN ('scheduled','checked_in','report_submitted')`, [me, today]),
      this.n(`SELECT count(*)::int AS n FROM leads.followups WHERE employee_id = $1 AND status = 'pending' AND due_date <= $2`, [me, today]),
      this.n(`SELECT count(*)::int AS n FROM leads.followups WHERE employee_id = $1 AND status = 'pending' AND due_date < $2`, [me, today]),
      this.n(`SELECT count(*)::int AS n FROM leads.call_logs WHERE employee_id = $1 AND called_at >= ((now() AT TIME ZONE 'Asia/Kolkata')::date)::timestamp AT TIME ZONE 'Asia/Kolkata'`, [me]),
      this.sql.all<{ key: string; n: number }>(`SELECT status AS key, count(*)::int AS n FROM leads.purchase_requests WHERE creator_user_id = $1 GROUP BY status`, [actor.id]).then(counts),
    ]);
    return { ...(await teleSalesExtras(this.sql, me, actor.id, today)), date: today, assignedDistributors: distributors, visitsToday, followupsDueToday: followupsDue, overdueFollowups: overdue, callsToday, myPurchaseRequests: requests };
  }

  async supportManager(actor: Principal) {
    const c = actor.companyId;
    const [byStatus, unassigned, reopened, workload, closedLast7] = await Promise.all([
      this.grouped("complaints", "status", c),
      this.n(`SELECT count(*)::int AS n FROM leads.complaints WHERE company_id = $1 AND status IN ('open','reopened')`, [c]),
      this.n(`SELECT count(*)::int AS n FROM leads.complaints WHERE company_id = $1 AND reopen_count > 0`, [c]),
      this.sql.all(
        `SELECT e.id AS engineer_id, e.name,
                (SELECT count(*)::int FROM leads.complaint_assignments a JOIN leads.complaints k ON k.id = a.complaint_id WHERE a.engineer_id = e.id AND a.is_current AND k.status IN ('assigned','in_progress','pending')) AS active_jobs,
                (SELECT count(*)::int FROM leads.service_reports r WHERE r.engineer_id = e.id AND r.submitted_at >= now() - interval '30 days') AS reports_last_30_days
           FROM leads.employees e JOIN leads.roles r ON r.id = e.role_id WHERE e.company_id = $1 AND e.is_active AND r.code = 'field_support' ORDER BY e.name`,
        [c],
      ),
      this.n(`SELECT count(*)::int AS n FROM leads.complaints WHERE company_id = $1 AND closed_at >= now() - interval '7 days'`, [c]),
    ]);
    return { ...(await supportExtras(this.sql, c, todayIst())), complaints: byStatus, awaitingAssignment: unassigned, reopenedEver: reopened, closedLast7Days: closedLast7, engineers: workload };
  }

  async hr(actor: Principal) {
    const c = actor.companyId;
    const today = todayIst();
    const month = today.slice(0, 7);
    const [employees, present, onLeave, pendingLeaves, pendingExpenses, approvedUnpaid, payroll, holidays] = await Promise.all([
      this.n(`SELECT count(*)::int AS n FROM leads.employees WHERE company_id = $1 AND is_active`, [c]),
      this.n(`SELECT count(*)::int AS n FROM leads.lead_attendances a JOIN leads.employees e ON e.user_id = a.agent_id WHERE e.company_id = $1 AND a.date = $2 AND a.checked_in`, [c, today]),
      this.n(`SELECT count(*)::int AS n FROM leads.leaves WHERE company_id = $1 AND status = 'approved' AND from_date <= $2 AND to_date >= $2`, [c, today]),
      this.n(`SELECT count(*)::int AS n FROM leads.leaves WHERE company_id = $1 AND status = 'pending'`, [c]),
      this.n(`SELECT count(*)::int AS n FROM leads.expenses WHERE company_id = $1 AND status = 'submitted'`, [c]),
      this.n(`SELECT count(*)::int AS n FROM leads.expenses WHERE company_id = $1 AND status = 'approved'`, [c]),
      this.grouped("payroll", "status", c, "AND month = $2", [month]),
      this.sql.all(`SELECT holiday_date, name FROM leads.holidays WHERE company_id = $1 AND holiday_date >= $2 ORDER BY holiday_date LIMIT 5`, [c, today]),
    ]);
    return { ...(await hrExtras(this.sql, c, today)), date: today, activeEmployees: employees, presentToday: present, onLeaveToday: onLeave, pendingLeaves, expensesAwaitingApproval: pendingExpenses, expensesAwaitingReimbursement: approvedUnpaid, payroll: { month, byStatus: payroll }, upcomingHolidays: holidays };
  }

  async distributor(actor: Principal) {
    if (!actor.distributorId) throw new ForbiddenException("This dashboard is for distributor accounts");
    const id = actor.distributorId;
    const [byStatus, awaitingPayment, recent] = await Promise.all([
      this.sql.all<{ key: string; n: number }>(`SELECT status AS key, count(*)::int AS n FROM leads.purchase_requests WHERE distributor_id = $1 GROUP BY status`, [id]).then(counts),
      this.n(`SELECT count(*)::int AS n FROM leads.purchase_requests WHERE distributor_id = $1 AND payment_status = 'pending' AND status IN ('submitted','under_review')`, [id]),
      this.sql.all(`SELECT id, request_no, status, payment_status, created_at FROM leads.purchase_requests WHERE distributor_id = $1 ORDER BY created_at DESC LIMIT 5`, [id]),
    ]);
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const pending = (byStatus.submitted ?? 0) + (byStatus.under_review ?? 0) + (byStatus.correction_required ?? 0) + (byStatus.draft ?? 0);
    return { totalRequests: total, pending, approved: byStatus.approved ?? 0, processed: byStatus.processed ?? 0, rejected: byStatus.rejected ?? 0, cancelled: byStatus.cancelled ?? 0, byStatus, paymentsAwaitingVerification: awaitingPayment, recent };
  }
}
