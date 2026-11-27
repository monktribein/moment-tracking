import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { todayIst } from "../../../common/eco/http";
import { paginate, Where } from "../../../common/eco/pagination";
import { type Db, SqlService } from "../../../database/sql/sql.service";
import { AuditService } from "../../audit/application/audit.service";
import { can, type Principal } from "../../rbac/domain/principal";
import { NEW_ID } from "../../users-employees/application/account.service";
import { computePayroll, mergeSettings, monthDays, PAYROLL_SETTING_KEYS, type DayFacts, type PayrollSettings } from "../domain/payroll";
import type { AdjustmentDto, PayrollQueryDto } from "../presentation/hr.dto";

const COLS = `p.id, p.employee_id, e.name AS employee_name, e.employee_code, p.month, p.fixed_salary, p.calc_days, p.payable_days, p.unpaid_leave_days, p.adjustments, p.adjustment_note,
  p.net_payable, p.status, p.approved_by, p.approved_at, p.finalized_by, p.finalized_at, p.updated_at`;
const FROM = `leads.payroll p JOIN leads.employees e ON e.id = p.employee_id`;

@Injectable()
export class PayrollService {
  constructor(
    private readonly sql: SqlService,
    private readonly audit: AuditService,
  ) {}

  async settings(companyId: string, db: Db = this.sql): Promise<PayrollSettings> {
    const rows = await db.all<{ key: string; value: unknown }>(`SELECT key, value FROM leads.system_settings WHERE company_id = $1 AND key LIKE 'payroll.%'`, [companyId]);
    return mergeSettings(rows);
  }

  async saveSettings(actor: Principal, input: Record<string, unknown>) {
    const updates: [string, unknown][] = [];
    for (const [key, value] of Object.entries(input)) {
      const full = key.startsWith("payroll.") ? key : `payroll.${key}`;
      if (!(full in PAYROLL_SETTING_KEYS)) throw new BadRequestException(`Unknown payroll setting: ${key}`);
      updates.push([full, value]);
    }
    const checks: Record<string, (v: unknown) => boolean> = {
      "payroll.calc_days_mode": (v) => ["calendar", "fixed", "working"].includes(String(v)),
      "payroll.calc_days_fixed": (v) => Number.isInteger(v) && (v as number) >= 20 && (v as number) <= 31,
      "payroll.half_day_enabled": (v) => typeof v === "boolean",
      "payroll.half_day_minutes": (v) => Number.isInteger(v) && (v as number) >= 30 && (v as number) <= 720,
      "payroll.absent_unpaid": (v) => typeof v === "boolean",
      "payroll.paid_leave_types": (v) => Array.isArray(v) && v.every((x) => ["casual", "sick", "earned", "unpaid", "other"].includes(String(x))),
    };
    for (const [k, v] of updates) if (!checks[k](v)) throw new BadRequestException(`Invalid value for ${k}`);
    return this.sql.tx(async (db) => {
      const before = await this.settings(actor.companyId, db);
      for (const [k, v] of updates)
        await db.exec(`INSERT INTO leads.system_settings (company_id, key, value, updated_by) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (company_id, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by`, [actor.companyId, k, JSON.stringify(v), actor.id]);
      const after = await this.settings(actor.companyId, db);
      await this.audit.log(actor, "settings.payroll_changed", "system_settings", null, before, after, null, db);
      return after;
    });
  }

  list(actor: Principal, query: PayrollQueryDto) {
    const where = new Where().eq("p.company_id = ?", actor.companyId).eq("p.month = ?", query.month);
    if (can(actor, "payroll.manage")) where.eq("p.status = ?", query.status).eq("p.employee_id = ?", query.employeeId);
    else where.eq("p.employee_id = ?", actor.employeeId ?? "none").raw("p.status = 'finalized'"); // an employee sees only their own finalized payslips
    where.search(["e.name", "e.employee_code"], query.search);
    return paginate(this.sql, { select: COLS, from: FROM, where, sorts: { month: "p.month", name: "e.name", netPayable: "p.net_payable" }, query, tiebreak: "p.id" });
  }

  private async one(db: Db, companyId: string, id: string) {
    const row = await db.one(`SELECT ${COLS} FROM ${FROM} WHERE p.id = $1 AND p.company_id = $2`, [id, companyId]);
    if (!row) throw new NotFoundException("Payroll record not found");
    return row;
  }

  /** The inputs of the day-by-day calculation for one employee and month. */
  private async facts(db: Db, companyId: string, emp: { id: string; userId: string }, month: string): Promise<DayFacts[]> {
    const days = monthDays(month);
    const first = days[0].date;
    const last = days[days.length - 1].date;
    const [attendance, holidays, leaves] = await Promise.all([
      db.all<any>(`SELECT date, checked_in, checked_out, total_working_minutes, status FROM leads.lead_attendances WHERE company_id = $1 AND agent_id = $2 AND date BETWEEN $3 AND $4`, [companyId, emp.userId, first, last]),
      db.all<{ holidayDate: string }>(`SELECT holiday_date FROM leads.holidays WHERE company_id = $1 AND holiday_date BETWEEN $2 AND $3 AND NOT is_optional`, [companyId, first, last]),
      db.all<any>(`SELECT from_date, to_date, leave_type FROM leads.leaves WHERE employee_id = $1 AND status = 'approved' AND from_date <= $3 AND to_date >= $2`, [emp.id, first, last]),
    ]);
    const att = new Map(attendance.map((a) => [a.date, a]));
    const hol = new Set(holidays.map((h) => h.holidayDate));
    return days.map(({ date, weekday }) => {
      const a = att.get(date);
      const leave = leaves.find((l) => l.fromDate <= date && l.toDate >= date);
      const attended = Boolean(a && a.status !== "absent" && (a.checkedIn || a.status === "present" || a.status === "half_day"));
      return {
        date,
        weekday,
        attended,
        workedMinutes: a?.status === "half_day" ? 0 : (a?.totalWorkingMinutes ?? null),
        checkedOut: Boolean(a?.checkedOut || a?.status === "half_day"),
        holiday: hol.has(date),
        leaveType: leave?.leaveType ?? null,
      };
    });
  }

  /**
   * Creates or recomputes the month's DRAFT payroll for every active employee (or one).
   * Approved and finalized rows are left alone. Salary comes from salary_master (latest effective
   * on or before month-end) or the employee record.
   */
  async generate(actor: Principal, month: string, employeeId?: string) {
    const monthEnd = monthDays(month).at(-1)!.date;
    const asOf = todayIst() < monthEnd ? todayIst() : monthEnd;
    if (`${month}-01` > todayIst()) throw new BadRequestException("Payroll cannot be generated for a future month");
    return this.sql.tx(async (db) => {
      const settings = await this.settings(actor.companyId, db);
      const emps = await db.all<any>(
        `SELECT e.id, e.user_id, e.name, e.fixed_salary, e.weekly_off,
                coalesce((SELECT s.fixed_salary FROM leads.salary_master s WHERE s.employee_id = e.id AND s.effective_from <= $3 ORDER BY s.effective_from DESC LIMIT 1), e.fixed_salary) AS salary
           FROM leads.employees e WHERE e.company_id = $1 AND e.is_active AND ($2::text IS NULL OR e.id = $2) AND (e.joining_date IS NULL OR e.joining_date <= $3) ORDER BY e.name`,
        [actor.companyId, employeeId ?? null, monthEnd],
      );
      if (employeeId && !emps.length) throw new NotFoundException("Employee not found, inactive, or not yet joined in that month");
      const summary = { created: 0, updated: 0, skipped: [] as { employee: string; reason: string }[] };
      for (const e of emps) {
        const existing = await db.one<any>(`SELECT id, status, adjustments FROM leads.payroll WHERE employee_id = $1 AND month = $2 FOR UPDATE`, [e.id, month]);
        if (existing && existing.status !== "draft") {
          summary.skipped.push({ employee: e.name, reason: `already ${existing.status}` });
          continue;
        }
        const adjustments = existing?.adjustments ?? 0;
        const days = await this.facts(db, actor.companyId, { id: e.id, userId: e.userId }, month);
        const r = computePayroll({ fixedSalary: e.salary, weeklyOff: e.weeklyOff ?? ["sunday"], days, asOf, adjustments, settings });
        if (existing) {
          await db.exec(`UPDATE leads.payroll SET fixed_salary = $2, calc_days = $3, payable_days = $4, unpaid_leave_days = $5, net_payable = $6 WHERE id = $1`, [existing.id, e.salary, r.calcDays, r.payableDays, r.unpaidDays, r.netPayable]);
          summary.updated++;
        } else {
          await db.exec(`INSERT INTO leads.payroll (id, company_id, employee_id, month, fixed_salary, calc_days, payable_days, unpaid_leave_days, adjustments, net_payable) VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6, $7, 0, $8)`, [actor.companyId, e.id, month, e.salary, r.calcDays, r.payableDays, r.unpaidDays, r.netPayable]);
          summary.created++;
        }
      }
      await this.audit.log(actor, "payroll.generated", "payroll", null, null, { month, employeeId: employeeId ?? null, ...summary }, null, db);
      return { month, asOf, settings, ...summary };
    });
  }

  /** Authorised adjustment on a draft row (bonus, deduction); a note is mandatory. Net pay is recomputed. */
  adjust(actor: Principal, id: string, dto: AdjustmentDto) {
    return this.sql.tx(async (db) => {
      const p = await db.one<any>(`SELECT * FROM leads.payroll WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
      if (!p) throw new NotFoundException("Payroll record not found");
      if (p.status !== "draft") throw new ConflictException(`A ${p.status} payroll record cannot be adjusted`);
      const net = Math.round(((p.fixedSalary / p.calcDays) * p.payableDays + dto.adjustments + Number.EPSILON) * 100) / 100;
      await db.exec(`UPDATE leads.payroll SET adjustments = $2, adjustment_note = $3, net_payable = $4 WHERE id = $1`, [id, dto.adjustments, dto.adjustments === 0 ? null : (dto.note ?? null), net]);
      await this.audit.log(actor, "payroll.adjusted", "payroll", id, { adjustments: p.adjustments, netPayable: p.netPayable }, { adjustments: dto.adjustments, netPayable: net }, dto.note ?? null, db);
      return this.one(db, actor.companyId, id);
    });
  }

  private move(actor: Principal, id: string, from: string, to: "approved" | "finalized") {
    return this.sql.tx(async (db) => {
      const p = await db.one<any>(`SELECT * FROM leads.payroll WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
      if (!p) throw new NotFoundException("Payroll record not found");
      if (p.status !== from) throw new ConflictException(`A ${p.status} payroll record cannot be ${to}${p.status === "finalized" ? " (it is locked)" : ""}`);
      if (to === "approved") await db.exec(`UPDATE leads.payroll SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1`, [id, actor.id]);
      else await db.exec(`UPDATE leads.payroll SET status = 'finalized', finalized_by = $2, finalized_at = now() WHERE id = $1`, [id, actor.id]);
      await this.audit.log(actor, `payroll.${to}`, "payroll", id, { status: p.status, netPayable: p.netPayable }, { status: to, netPayable: p.netPayable }, null, db);
      return this.one(db, actor.companyId, id);
    });
  }

  approve(actor: Principal, id: string) {
    return this.move(actor, id, "draft", "approved");
  }

  /** After this the row is locked: the database refuses any further change or deletion. */
  finalize(actor: Principal, id: string) {
    return this.move(actor, id, "approved", "finalized");
  }
}

