import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { guarded } from "../../../common/eco/http";
import { paginate, Where } from "../../../common/eco/pagination";
import { type Db, SqlService } from "../../../database/sql/sql.service";
import { AuditService } from "../../audit/application/audit.service";
import { can, type Principal } from "../../rbac/domain/principal";
import { AccountService, NEW_ID } from "./account.service";
import type { CreateEmployeeDto, EmployeeQueryDto, UpdateEmployeeDto } from "../presentation/employees.dto";

const SELECT = `e.id, e.user_id, e.employee_code, e.name, e.mobile, e.email, e.address, e.photo_url, e.designation, e.department,
  r.code AS role, e.manager_id, m.name AS manager_name, e.joining_date, e.fixed_salary, e.weekly_off, e.is_active, e.created_at, e.updated_at`;
const FROM = `leads.employees e LEFT JOIN leads.roles r ON r.id = e.role_id LEFT JOIN leads.employees m ON m.id = e.manager_id`;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly sql: SqlService,
    private readonly accounts: AccountService,
    private readonly audit: AuditService,
  ) {}

  /** HR and admin see everyone; managers see their team; everyone else sees only themselves. */
  private visibility(actor: Principal, where: Where): void {
    if (can(actor, "employees.manage")) return;
    const me = where.param(actor.employeeId ?? "");
    where.raw(`(e.id = ${me} OR e.manager_id = ${me})`);
  }

  async list(actor: Principal, query: EmployeeQueryDto) {
    const where = new Where().eq("e.company_id = ?", actor.companyId).eq("r.code = ?", query.role).eq("e.manager_id = ?", query.managerId).eq("e.department = ?", query.department);
    if (query.active !== undefined) where.eq("e.is_active = ?", query.active);
    where.search(["e.name", "e.mobile", "e.email", "e.employee_code"], query.search);
    this.visibility(actor, where);
    return paginate(this.sql, { select: SELECT, from: FROM, where, sorts: { name: "e.name", createdAt: "e.created_at", employeeCode: "e.employee_code", joiningDate: "e.joining_date" }, query, defaultOrder: "asc", tiebreak: "e.id" });
  }

  async get(actor: Principal, id: string, db: Db = this.sql) {
    const where = new Where().eq("e.company_id = ?", actor.companyId).eq("e.id = ?", id);
    this.visibility(actor, where);
    const row = await db.one(`SELECT ${SELECT} FROM ${FROM} ${where.sql}`, where.params);
    if (!row) throw new NotFoundException("Employee not found");
    return row;
  }

  private async assertManager(db: Db, companyId: string, managerId: string, selfId?: string) {
    if (managerId === selfId) throw new BadRequestException("An employee cannot be their own manager");
    let cursor: string | null = managerId;
    for (let i = 0; i < 20 && cursor; i++) {
      const m: { id: string; managerId: string | null } | null = await db.one(`SELECT id, manager_id FROM leads.employees WHERE id = $1 AND company_id = $2`, [cursor, companyId]);
      if (!m) throw new BadRequestException("Manager not found in this company");
      if (selfId && m.managerId === selfId) throw new BadRequestException("That would make the reporting line circular");
      cursor = m.managerId;
    }
  }

  async create(actor: Principal, dto: CreateEmployeeDto) {
    const mobile = this.accounts.mobile(dto.mobile);
    const password = dto.password ?? this.accounts.temporaryPassword();
    const result = await guarded(
      () =>
        this.sql.tx(async (db) => {
          if (dto.managerId) await this.assertManager(db, actor.companyId, dto.managerId);
          const code = dto.employeeCode ?? (await db.one<{ n: string }>(`SELECT leads.next_doc_no($1, 'EMP') AS n`, [actor.companyId]))!.n;
          const userId = await this.accounts.createLogin(db, { companyId: actor.companyId, name: dto.name, mobile, email: dto.email, password, roleCode: dto.roleCode, employeeCode: code, createdBy: { id: actor.id, name: actor.name } });
          const roleId = await this.accounts.roleId(db, actor.companyId, dto.roleCode);
          const row = await db.one<{ id: string }>(
            `INSERT INTO leads.employees (id, company_id, user_id, employee_code, name, mobile, email, address, designation, department, role_id, manager_id, joining_date, fixed_salary, weekly_off, created_by)
             VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
            [actor.companyId, userId, code, dto.name, mobile, dto.email ?? null, dto.address ?? null, dto.designation ?? null, dto.department ?? null, roleId, dto.managerId ?? null, dto.joiningDate ?? null, dto.fixedSalary ?? 0, dto.weeklyOff ?? ["sunday"], actor.id],
          );
          const created = await this.get(actor, row!.id, db);
          await this.audit.log(actor, "employee.created", "employee", row!.id, null, created, null, db);
          return created;
        }),
      "An employee with that code, mobile number or email already exists",
    );
    return { employee: result, temporaryPassword: dto.password ? undefined : password };
  }

  async update(actor: Principal, id: string, dto: UpdateEmployeeDto) {
    return guarded(
      () =>
        this.sql.tx(async (db) => {
          const before = await db.one<any>(`SELECT * FROM leads.employees WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
          if (!before) throw new NotFoundException("Employee not found");
          // Roles and account status are the Super Admin's (admin) decision; HR edits the HR details.
          if ((dto.roleCode !== undefined || dto.isActive !== undefined) && actor.role !== "admin") throw new ForbiddenException("Only the Super Admin can change roles or activate/deactivate accounts");
          if (dto.isActive === false && before.userId === actor.id) throw new ForbiddenException("You cannot deactivate your own account");
          if (dto.managerId) await this.assertManager(db, actor.companyId, dto.managerId, id);
          const mobile = dto.mobile ? this.accounts.mobile(dto.mobile) : undefined;
          const roleId = dto.roleCode ? await this.accounts.roleId(db, actor.companyId, dto.roleCode) : undefined;
          await db.exec(
            `UPDATE leads.employees SET name = coalesce($3, name), mobile = coalesce($4, mobile), email = coalesce($5, email), address = coalesce($6, address), designation = coalesce($7, designation),
               department = coalesce($8, department), role_id = coalesce($9, role_id), manager_id = coalesce($10, manager_id), joining_date = coalesce($11, joining_date),
               fixed_salary = coalesce($12, fixed_salary), weekly_off = coalesce($13, weekly_off) WHERE id = $1 AND company_id = $2`,
            [id, actor.companyId, dto.name ?? null, mobile ?? null, dto.email ?? null, dto.address ?? null, dto.designation ?? null, dto.department ?? null, roleId ?? null, dto.managerId ?? null, dto.joiningDate ?? null, dto.fixedSalary ?? null, dto.weeklyOff ?? null],
          );
          if (dto.name || mobile || dto.email !== undefined || dto.roleCode)
            await db.exec(
              `UPDATE leads.lead_users SET name = coalesce($2, name), phone = coalesce($3, phone), email = coalesce($4, email), role = coalesce($5, role), role_id = coalesce($6, role_id),
                 token_version = token_version + ${dto.roleCode ? 1 : 0} WHERE id = $1`,
              [before.userId, dto.name ?? null, mobile ?? null, dto.email?.toLowerCase() ?? null, dto.roleCode ?? null, roleId ?? null],
            );
          if (dto.isActive !== undefined && dto.isActive !== before.isActive) {
            await db.exec(`UPDATE leads.employees SET is_active = $2 WHERE id = $1`, [id, dto.isActive]);
            await this.accounts.setLoginActive(db, before.userId, dto.isActive);
          }
          const after = await this.get(actor, id, db);
          await this.audit.log(actor, dto.isActive === undefined ? "employee.updated" : dto.isActive ? "employee.activated" : "employee.deactivated", "employee", id, before, after, null, db);
          return after;
        }),
      "That mobile number, email or employee code is already in use",
    );
  }

  async setActive(actor: Principal, id: string, active: boolean, reason?: string) {
    return this.sql.tx(async (db) => {
      const e = await db.one<any>(`SELECT id, user_id, is_active FROM leads.employees WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
      if (!e) throw new NotFoundException("Employee not found");
      if (!active && e.userId === actor.id) throw new ForbiddenException("You cannot deactivate your own account");
      await db.exec(`UPDATE leads.employees SET is_active = $2 WHERE id = $1`, [id, active]);
      await this.accounts.setLoginActive(db, e.userId, active);
      await this.audit.log(actor, active ? "employee.activated" : "employee.deactivated", "employee", id, { isActive: e.isActive }, { isActive: active }, reason ?? null, db);
      return this.get(actor, id, db);
    });
  }

  /** Sets a new temporary password (returned once) and signs the employee out everywhere. */
  async resetPassword(actor: Principal, id: string) {
    const password = this.accounts.temporaryPassword();
    await this.sql.tx(async (db) => {
      const e = await db.one<any>(`SELECT user_id FROM leads.employees WHERE id = $1 AND company_id = $2`, [id, actor.companyId]);
      if (!e) throw new NotFoundException("Employee not found");
      await this.accounts.setPassword(db, e.userId, password);
      await this.audit.log(actor, "employee.password_reset", "employee", id, null, null, null, db);
    });
    return { temporaryPassword: password };
  }
}
