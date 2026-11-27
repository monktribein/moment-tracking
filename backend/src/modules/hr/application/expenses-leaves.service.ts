import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { guarded, todayIst } from "../../../common/eco/http";
import { paginate, Where } from "../../../common/eco/pagination";
import { type Db, SqlService } from "../../../database/sql/sql.service";
import { AuditService } from "../../audit/application/audit.service";
import { can, type Principal } from "../../rbac/domain/principal";
import { NEW_ID } from "../../users-employees/application/account.service";
import { checkIdempotencyKey, findIdempotent, rememberIdempotent } from "../../../common/eco/idempotency";
import type { CreateExpenseDto, CreateLeaveDto, ExpenseQueryDto, LeaveQueryDto } from "../presentation/hr.dto";

/** HR and admin approve for everyone; any other approver only for the people who report to them, and never for themselves. */
const seesEveryone = (actor: Principal): boolean => actor.role === "admin" || actor.role === "hr";

@Injectable()
export class ExpensesLeavesService {
  constructor(
    private readonly sql: SqlService,
    private readonly audit: AuditService,
  ) {}

  private needEmployee(actor: Principal): string {
    if (!actor.employeeId) throw new ForbiddenException("This is for employee accounts");
    return actor.employeeId;
  }

  /** Adds the visibility rule for a list of rows owned by `e.id` (employee). */
  private visibility(actor: Principal, where: Where, filterEmployee?: string): void {
    if (seesEveryone(actor)) {
      where.eq("e.id = ?", filterEmployee);
      return;
    }
    const me = where.param(actor.employeeId ?? "none");
    if (can(actor, "expenses.approve") || can(actor, "leaves.approve")) where.raw(`(e.id = ${me} OR e.manager_id = ${me})`);
    else where.raw(`e.id = ${me}`);
    if (filterEmployee) where.eq("e.id = ?", filterEmployee);
  }

  private async assertCanDecide(db: Db, actor: Principal, ownerEmployeeId: string, kind: string): Promise<void> {
    if (ownerEmployeeId === actor.employeeId) throw new ForbiddenException(`You cannot decide on your own ${kind}`);
    if (seesEveryone(actor)) return;
    const owner = await db.one<{ managerId: string | null }>(`SELECT manager_id FROM leads.employees WHERE id = $1`, [ownerEmployeeId]);
    if (!actor.employeeId || owner?.managerId !== actor.employeeId) throw new ForbiddenException(`You can only decide on ${kind}s of people who report to you`);
  }

  // ---------------------------------------------------------------- expenses
  listExpenses(actor: Principal, query: ExpenseQueryDto) {
    const where = new Where().eq("x.company_id = ?", actor.companyId).eq("x.status = ?", query.status).eq("x.expense_date >= ?", query.from).eq("x.expense_date <= ?", query.to);
    this.visibility(actor, where, query.employeeId);
    where.search(["e.name", "x.category", "x.description"], query.search);
    return paginate(this.sql, {
      select: "x.id, x.employee_id, e.name AS employee_name, x.expense_date, x.category, x.amount, x.description, x.receipt_key, x.visit_id, x.status, x.rejection_reason, x.reimbursed_at, x.reimbursement_ref, x.created_at",
      from: "leads.expenses x JOIN leads.employees e ON e.id = x.employee_id",
      where,
      sorts: { expenseDate: "x.expense_date", createdAt: "x.created_at", amount: "x.amount", status: "x.status" },
      query,
      tiebreak: "x.id",
    });
  }

  async createExpense(actor: Principal, dto: CreateExpenseDto, idempotencyKey?: string) {
    const employeeId = this.needEmployee(actor);
    const key = checkIdempotencyKey(idempotencyKey);
    if (dto.expenseDate > todayIst()) throw new BadRequestException("The expense date cannot be in the future");
    if (dto.receiptKey && !dto.receiptKey.startsWith(`${actor.companyId}/`)) throw new BadRequestException("The receipt file key is not valid");
    return guarded(() =>
      this.sql.tx(async (db) => {
        const replay = await findIdempotent(db, "expenses", "employee_id", employeeId, key);
        if (replay) return db.one(`SELECT * FROM leads.expenses WHERE id = $1`, [replay]);
        const limit = await db.one<{ value: number }>(`SELECT value FROM leads.system_settings WHERE company_id = $1 AND key = 'expenses.receipt_required_above'`, [actor.companyId]);
        const receiptAbove = Number(limit?.value ?? 500);
        if (dto.amount > receiptAbove && !dto.receiptKey) throw new BadRequestException(`A receipt is required for expenses above ${receiptAbove}`);
        if (dto.visitId && !(await db.one(`SELECT 1 FROM leads.sales_visits WHERE id = $1 AND company_id = $2 AND employee_id = $3`, [dto.visitId, actor.companyId, employeeId]))) throw new BadRequestException("That visit is not yours");
        const row = await db.one<{ id: string }>(
          `INSERT INTO leads.expenses (id, company_id, employee_id, expense_date, category, amount, description, receipt_key, visit_id) VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [actor.companyId, employeeId, dto.expenseDate, dto.category, dto.amount, dto.description ?? null, dto.receiptKey ?? null, dto.visitId ?? null],
        );
        await rememberIdempotent(db, "expenses", row!.id, key);
        await this.audit.log(actor, "expense.submitted", "expense", row!.id, null, dto, null, db);
        return db.one(`SELECT * FROM leads.expenses WHERE id = $1`, [row!.id]);
      }),
    );
  }

  private decideExpense(actor: Principal, id: string, action: "approved" | "rejected" | "reimbursed", reason: string | null, ref?: string) {
    const from = action === "reimbursed" ? "approved" : "submitted";
    return this.sql.tx(async (db) => {
      const x = await db.one<any>(`SELECT * FROM leads.expenses WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
      if (!x) throw new NotFoundException("Expense not found");
      await this.assertCanDecide(db, actor, x.employeeId, "expense");
      if (x.status !== from) throw new ConflictException(`A ${x.status} expense cannot be ${action}`);
      if (action === "reimbursed") await db.exec(`UPDATE leads.expenses SET status = 'reimbursed', reimbursed_at = now(), reimbursed_by = $2, reimbursement_ref = $3 WHERE id = $1`, [id, actor.id, ref ?? null]);
      else await db.exec(`UPDATE leads.expenses SET status = $2, rejection_reason = $3 WHERE id = $1`, [id, action, action === "rejected" ? reason : null]);
      await db.exec(`INSERT INTO leads.expense_approvals (company_id, expense_id, action, actor_id, reason) VALUES ($1, $2, $3, $4, $5)`, [actor.companyId, id, action, actor.id, reason ?? ref ?? null]);
      await this.audit.log(actor, `expense.${action}`, "expense", id, { status: x.status }, { status: action }, reason, db);
      return db.one(`SELECT * FROM leads.expenses WHERE id = $1`, [id]);
    });
  }

  approveExpense(actor: Principal, id: string) {
    return this.decideExpense(actor, id, "approved", null);
  }

  rejectExpense(actor: Principal, id: string, reason: string) {
    return this.decideExpense(actor, id, "rejected", reason);
  }

  /** Reimbursement is paid outside the system; this records that it was. */
  reimburseExpense(actor: Principal, id: string, reference?: string) {
    return this.decideExpense(actor, id, "reimbursed", null, reference);
  }

  // ------------------------------------------------------------------ leaves
  listLeaves(actor: Principal, query: LeaveQueryDto) {
    const where = new Where().eq("l.company_id = ?", actor.companyId).eq("l.status = ?", query.status).eq("l.to_date >= ?", query.from).eq("l.from_date <= ?", query.to);
    this.visibility(actor, where, query.employeeId);
    where.search(["e.name", "l.reason"], query.search);
    return paginate(this.sql, {
      select: "l.id, l.employee_id, e.name AS employee_name, l.from_date, l.to_date, l.leave_type, l.reason, l.status, l.approver_id, l.decided_at, l.decision_note, l.created_at",
      from: "leads.leaves l JOIN leads.employees e ON e.id = l.employee_id",
      where,
      sorts: { fromDate: "l.from_date", createdAt: "l.created_at", status: "l.status" },
      query,
      tiebreak: "l.id",
    });
  }

  createLeave(actor: Principal, dto: CreateLeaveDto) {
    const employeeId = this.needEmployee(actor);
    if (dto.toDate < dto.fromDate) throw new BadRequestException("The end date is before the start date");
    if (dto.fromDate < todayIst() && dto.leaveType !== "sick") throw new BadRequestException("Leave cannot start in the past (sick leave can be applied late)");
    return guarded(() =>
      this.sql.tx(async (db) => {
        const clash = await db.one(`SELECT 1 FROM leads.leaves WHERE employee_id = $1 AND status IN ('pending','approved') AND from_date <= $3 AND to_date >= $2`, [employeeId, dto.fromDate, dto.toDate]);
        if (clash) throw new ConflictException("You already have leave that overlaps these dates");
        const row = await db.one<{ id: string }>(`INSERT INTO leads.leaves (id, company_id, employee_id, from_date, to_date, leave_type, reason) VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6) RETURNING id`, [actor.companyId, employeeId, dto.fromDate, dto.toDate, dto.leaveType, dto.reason ?? null]);
        await this.audit.log(actor, "leave.applied", "leave", row!.id, null, dto, null, db);
        return db.one(`SELECT * FROM leads.leaves WHERE id = $1`, [row!.id]);
      }),
    );
  }

  private decideLeave(actor: Principal, id: string, status: "approved" | "rejected", note: string | null) {
    return this.sql.tx(async (db) => {
      const l = await db.one<any>(`SELECT * FROM leads.leaves WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
      if (!l) throw new NotFoundException("Leave not found");
      await this.assertCanDecide(db, actor, l.employeeId, "leave");
      if (l.status !== "pending") throw new ConflictException(`A ${l.status} leave cannot be ${status}`);
      await db.exec(`UPDATE leads.leaves SET status = $2, approver_id = $3, decided_at = now(), decision_note = $4 WHERE id = $1`, [id, status, actor.id, note]);
      await this.audit.log(actor, `leave.${status}`, "leave", id, { status: l.status }, { status }, note, db);
      return db.one(`SELECT * FROM leads.leaves WHERE id = $1`, [id]);
    });
  }

  approveLeave(actor: Principal, id: string, note: string | null) {
    return this.decideLeave(actor, id, "approved", note);
  }

  rejectLeave(actor: Principal, id: string, note: string) {
    return this.decideLeave(actor, id, "rejected", note);
  }
}
