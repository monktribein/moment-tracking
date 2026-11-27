import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { parseCsv } from "../../../common/eco/csv";
import { guarded } from "../../../common/eco/http";
import { paginate, Where } from "../../../common/eco/pagination";
import { type Db, SqlService } from "../../../database/sql/sql.service";
import { AuditService } from "../../audit/application/audit.service";
import { type Principal } from "../../rbac/domain/principal";
import { WhatsAppService } from "../../notifications/application/whatsapp.service";
import { AccountService, NEW_ID } from "../../users-employees/application/account.service";
import { canActFor, mapHeaders, scopeDistributors, validateImportRow, type ImportedDistributor } from "../domain/distributor-rules";
import type { AssignExecutiveDto, CreateDistributorDto, DistributorQueryDto, UpdateDistributorDto } from "../presentation/distributors.dto";

const COLS = `d.id, d.distributor_code, d.firm_name, d.contact_person, d.mobile, d.alt_mobile, d.email, d.gstin, d.address, d.city, d.state, d.pin,
  d.assigned_executive_id, ex.name AS executive_name, d.remarks, d.is_active, d.portal_access, d.user_id, d.created_at, d.updated_at`;
const FROM = `leads.distributors d LEFT JOIN leads.employees ex ON ex.id = d.assigned_executive_id`;
export const MAX_IMPORT_BYTES = 1024 * 1024;
const MAX_IMPORT_ROWS = 2000;

export interface ImportRowReport {
  row: number;
  status: "created" | "valid" | "failed";
  firmName?: string;
  errors: string[];
}

@Injectable()
export class DistributorsService {
  constructor(
    private readonly sql: SqlService,
    private readonly audit: AuditService,
    private readonly accounts: AccountService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  async list(actor: Principal, query: DistributorQueryDto) {
    const where = new Where();
    scopeDistributors(actor, where);
    where.eq("d.state = ?", query.state).eq("d.city = ?", query.city).eq("d.assigned_executive_id = ?", query.executiveId);
    if (query.active !== undefined) where.eq("d.is_active = ?", query.active);
    if (query.portal !== undefined) where.eq("d.portal_access = ?", query.portal);
    where.search(["d.firm_name", "d.contact_person", "d.mobile", "d.distributor_code", "d.city"], query.search);
    return paginate(this.sql, { select: COLS, from: FROM, where, sorts: { firmName: "d.firm_name", createdAt: "d.created_at", city: "d.city", distributorCode: "d.distributor_code" }, query, defaultOrder: "asc", tiebreak: "d.id" });
  }

  /** One distributor the caller is allowed to see (ownership applied), or 404. */
  async get(actor: Principal, id: string, db: Db = this.sql) {
    const where = new Where().eq("d.id = ?", id);
    scopeDistributors(actor, where);
    const row = await db.one(`SELECT ${COLS} FROM ${FROM} ${where.sql}`, where.params);
    if (!row) throw new NotFoundException("Distributor not found");
    return row;
  }

  /** The distributor an employee is raising work for; employees may only pick distributors they are authorized for. */
  async forActor(actor: Principal, id: string, db: Db = this.sql): Promise<{ id: string; assignedExecutiveId: string | null; isActive: boolean; mobile: string; firmName: string; userId: string | null }> {
    const d = await db.one<any>(`SELECT id, assigned_executive_id, is_active, mobile, firm_name, user_id FROM leads.distributors WHERE id = $1 AND company_id = $2`, [id, actor.companyId]);
    if (!d || !canActFor(actor, d)) throw new NotFoundException("Distributor not found");
    return d;
  }

  private async assertExecutive(db: Db, companyId: string, employeeId: string) {
    const e = await db.one<{ role: string }>(`SELECT r.code AS role FROM leads.employees e JOIN leads.roles r ON r.id = e.role_id WHERE e.id = $1 AND e.company_id = $2 AND e.is_active`, [employeeId, companyId]);
    if (!e) throw new BadRequestException("Executive not found or inactive");
    if (!["tele_sales", "field_sales", "sales_manager", "admin"].includes(e.role)) throw new BadRequestException("Only sales staff can be assigned as executive");
  }

  create(actor: Principal, dto: CreateDistributorDto) {
    const mobile = this.accounts.mobile(dto.mobile);
    return guarded(
      () =>
        this.sql.tx(async (db) => {
          if (dto.assignedExecutiveId) await this.assertExecutive(db, actor.companyId, dto.assignedExecutiveId);
          const code = dto.distributorCode ?? (await db.one<{ n: string }>(`SELECT leads.next_doc_no($1, 'DST') AS n`, [actor.companyId]))!.n;
          const row = await db.one<{ id: string }>(
            `INSERT INTO leads.distributors (id, company_id, distributor_code, firm_name, contact_person, mobile, alt_mobile, email, gstin, address, city, state, pin, assigned_executive_id, remarks, created_by)
             VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
            [actor.companyId, code, dto.firmName, dto.contactPerson, mobile, dto.altMobile ?? null, dto.email ?? null, dto.gstin ?? null, dto.address ?? null, dto.city ?? null, dto.state ?? null, dto.pin ?? null, dto.assignedExecutiveId ?? null, dto.remarks ?? null, actor.id],
          );
          if (dto.assignedExecutiveId) await db.exec(`INSERT INTO leads.distributor_assignments (company_id, distributor_id, employee_id, assigned_by, reason) VALUES ($1, $2, $3, $4, 'Initial assignment')`, [actor.companyId, row!.id, dto.assignedExecutiveId, actor.id]);
          const created = await this.get(actor, row!.id, db);
          await this.audit.log(actor, "distributor.created", "distributor", row!.id, null, created, null, db);
          return created;
        }),
      "A distributor with that code already exists",
    );
  }

  update(actor: Principal, id: string, dto: UpdateDistributorDto) {
    const mobile = dto.mobile ? this.accounts.mobile(dto.mobile) : null;
    return guarded(() =>
      this.sql.tx(async (db) => {
        const before = await db.one<any>(`SELECT * FROM leads.distributors WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
        if (!before) throw new NotFoundException("Distributor not found");
        await db.exec(
          `UPDATE leads.distributors SET firm_name = coalesce($3, firm_name), contact_person = coalesce($4, contact_person), mobile = coalesce($5, mobile), alt_mobile = coalesce($6, alt_mobile),
             email = coalesce($7, email), gstin = coalesce($8, gstin), address = coalesce($9, address), city = coalesce($10, city), state = coalesce($11, state), pin = coalesce($12, pin),
             remarks = coalesce($13, remarks), is_active = coalesce($14, is_active) WHERE id = $1 AND company_id = $2`,
          [id, actor.companyId, dto.firmName ?? null, dto.contactPerson ?? null, mobile, dto.altMobile ?? null, dto.email ?? null, dto.gstin ?? null, dto.address ?? null, dto.city ?? null, dto.state ?? null, dto.pin ?? null, dto.remarks ?? null, dto.isActive ?? null],
        );
        // A deactivated distributor cannot sign in to the portal.
        if (dto.isActive === false && before.userId) await this.accounts.setLoginActive(db, before.userId, false);
        const after = await this.get(actor, id, db);
        await this.audit.log(actor, dto.isActive === false ? "distributor.deactivated" : "distributor.updated", "distributor", id, before, after, null, db);
        return after;
      }),
    );
  }

  /** Moves the distributor to another executive and keeps the history. */
  assign(actor: Principal, id: string, dto: AssignExecutiveDto) {
    return this.sql.tx(async (db) => {
      const before = await db.one<{ assignedExecutiveId: string | null }>(`SELECT assigned_executive_id FROM leads.distributors WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
      if (!before) throw new NotFoundException("Distributor not found");
      await this.assertExecutive(db, actor.companyId, dto.employeeId);
      if (before.assignedExecutiveId === dto.employeeId) throw new BadRequestException("That executive is already assigned");
      await db.exec(`UPDATE leads.distributor_assignments SET unassigned_at = now() WHERE distributor_id = $1 AND unassigned_at IS NULL`, [id]);
      await db.exec(`INSERT INTO leads.distributor_assignments (company_id, distributor_id, employee_id, assigned_by, reason) VALUES ($1, $2, $3, $4, $5)`, [actor.companyId, id, dto.employeeId, actor.id, dto.reason ?? null]);
      await db.exec(`UPDATE leads.distributors SET assigned_executive_id = $2 WHERE id = $1`, [id, dto.employeeId]);
      await this.audit.log(actor, "distributor.executive_assigned", "distributor", id, { assignedExecutiveId: before.assignedExecutiveId }, { assignedExecutiveId: dto.employeeId }, dto.reason ?? null, db);
      return this.get(actor, id, db);
    });
  }

  /**
   * Turns the distributor's portal login on or off. The first time it creates the
   * login (the distributor's mobile number is the sign-in) with a temporary password
   * that is returned once; the distributor can also set their own with "forgot password".
   */
  async setPortalAccess(actor: Principal, id: string, enabled: boolean) {
    let temporaryPassword: string | undefined;
    const result = await guarded(
      () =>
        this.sql.tx(async (db) => {
          const d = await db.one<any>(`SELECT * FROM leads.distributors WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
          if (!d) throw new NotFoundException("Distributor not found");
          if (enabled && !d.isActive) throw new BadRequestException("Activate the distributor before giving portal access");
          let userId: string | null = d.userId;
          if (enabled) {
            if (userId) await this.accounts.setLoginActive(db, userId, true);
            else {
              temporaryPassword = this.accounts.temporaryPassword();
              userId = await this.accounts.createLogin(db, { companyId: actor.companyId, name: d.contactPerson, mobile: d.mobile, email: d.email, password: temporaryPassword, roleCode: "distributor", employeeCode: d.distributorCode, createdBy: { id: actor.id, name: actor.name } });
            }
          } else if (userId) await this.accounts.setLoginActive(db, userId, false);
          await db.exec(`UPDATE leads.distributors SET portal_access = $2, user_id = $3 WHERE id = $1`, [id, enabled, userId]);
          await this.audit.log(actor, enabled ? "distributor.portal_enabled" : "distributor.portal_disabled", "distributor", id, { portalAccess: d.portalAccess }, { portalAccess: enabled }, null, db);
          return this.get(actor, id, db);
        }),
      "That mobile number is already registered as a login",
    );
    if (enabled) await this.whatsapp.notify({ companyId: actor.companyId, event: "distributor_account_activated", mobile: (result as any).mobile, params: [(result as any).firmName], entity: "distributor", entityId: id });
    return { distributor: result, temporaryPassword };
  }

  /** Recent visits, follow-ups and purchase requests of one distributor. */
  async history(actor: Principal, id: string) {
    await this.get(actor, id);
    const [visits, followups, requests] = await Promise.all([
      this.sql.all(`SELECT v.id, v.visit_date, v.purpose, v.status, v.priority, e.name AS employee_name FROM leads.sales_visits v JOIN leads.employees e ON e.id = v.employee_id WHERE v.distributor_id = $1 ORDER BY v.visit_date DESC, v.created_at DESC LIMIT 50`, [id]),
      this.sql.all(`SELECT f.id, f.source, f.due_date, f.status, f.notes, e.name AS employee_name FROM leads.followups f JOIN leads.employees e ON e.id = f.employee_id WHERE f.distributor_id = $1 ORDER BY f.due_date DESC LIMIT 50`, [id]),
      this.sql.all(`SELECT r.id, r.request_no, r.status, r.payment_status, r.source, r.created_at, (SELECT count(*)::int FROM leads.purchase_request_items i WHERE i.request_id = r.id) AS item_count FROM leads.purchase_requests r WHERE r.distributor_id = $1 ORDER BY r.created_at DESC LIMIT 50`, [id]),
    ]);
    return { visits, followups, requests };
  }

  /** CSV import with a row-by-row report. Valid rows are created; invalid rows are reported and skipped. */
  async importCsv(actor: Principal, file: Express.Multer.File | undefined, dryRun: boolean) {
    if (!file?.buffer?.length) throw new BadRequestException('No file provided (expected form field "file")');
    if (file.buffer.length > MAX_IMPORT_BYTES) throw new BadRequestException("The CSV is larger than 1 MB. Split it into smaller files.");
    if (file.buffer.includes(0)) throw new BadRequestException("That does not look like a CSV text file.");
    const rows = parseCsv(file.buffer.toString("utf8"));
    if (rows.length < 2) throw new BadRequestException("The CSV needs a header row and at least one data row.");
    if (rows.length - 1 > MAX_IMPORT_ROWS) throw new BadRequestException(`At most ${MAX_IMPORT_ROWS} rows per import.`);
    const { columns, unknown } = mapHeaders(rows[0]);
    if (!columns.includes("firmName") || !columns.includes("mobile")) throw new BadRequestException("The header must include at least firm_name, contact_person and mobile.");

    const reports: ImportRowReport[] = [];
    const seenMobiles = new Set<string>();
    const seenCodes = new Set<string>();
    await this.sql.tx(async (db) => {
      const executives = new Map((await db.all<{ employeeCode: string; id: string }>(`SELECT employee_code, id FROM leads.employees WHERE company_id = $1 AND is_active`, [actor.companyId])).map((e) => [e.employeeCode.toLowerCase(), e.id]));
      const existingCodes = new Set((await db.all<{ distributorCode: string }>(`SELECT distributor_code FROM leads.distributors WHERE company_id = $1`, [actor.companyId])).map((d) => d.distributorCode));
      for (let i = 1; i < rows.length; i++) {
        const raw: Partial<Record<keyof ImportedDistributor, string>> = {};
        columns.forEach((c, idx) => c && (raw[c] = rows[i][idx] ?? ""));
        const { value, errors } = validateImportRow(raw);
        const report: ImportRowReport = { row: i + 1, status: "failed", firmName: raw.firmName?.trim(), errors: [...errors] };
        reports.push(report);
        if (!value) continue;
        if (seenMobiles.has(value.mobile)) report.errors.push("mobile appears twice in this file");
        if (value.distributorCode && (seenCodes.has(value.distributorCode) || existingCodes.has(value.distributorCode))) report.errors.push("distributor_code already exists");
        const executiveId = value.executiveCode ? executives.get(value.executiveCode.toLowerCase()) : undefined;
        if (value.executiveCode && !executiveId) report.errors.push(`executive_code "${value.executiveCode}" is not an active employee`);
        if (report.errors.length) continue;
        seenMobiles.add(value.mobile);
        if (value.distributorCode) seenCodes.add(value.distributorCode);
        if (dryRun) {
          report.status = "valid";
          continue;
        }
        await db.exec("SAVEPOINT import_row");
        try {
          const code = value.distributorCode ?? (await db.one<{ n: string }>(`SELECT leads.next_doc_no($1, 'DST') AS n`, [actor.companyId]))!.n;
          const row = await db.one<{ id: string }>(
            `INSERT INTO leads.distributors (id, company_id, distributor_code, firm_name, contact_person, mobile, alt_mobile, email, gstin, address, city, state, pin, assigned_executive_id, remarks, created_by)
             VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
            [actor.companyId, code, value.firmName, value.contactPerson, value.mobile, value.altMobile ?? null, value.email ?? null, value.gstin ?? null, value.address ?? null, value.city ?? null, value.state ?? null, value.pin ?? null, executiveId ?? null, value.remarks ?? null, actor.id],
          );
          if (executiveId) await db.exec(`INSERT INTO leads.distributor_assignments (company_id, distributor_id, employee_id, assigned_by, reason) VALUES ($1, $2, $3, $4, 'CSV import')`, [actor.companyId, row!.id, executiveId, actor.id]);
          await db.exec("RELEASE SAVEPOINT import_row");
          report.status = "created";
        } catch (error) {
          await db.exec("ROLLBACK TO SAVEPOINT import_row");
          report.errors.push((error as { code?: string }).code === "23505" ? "a distributor with this code already exists" : "could not be saved");
        }
      }
      if (!dryRun) await this.audit.log(actor, "distributor.imported", "distributor", null, null, { created: reports.filter((r) => r.status === "created").length, failed: reports.filter((r) => r.status === "failed").length }, null, db);
    });
    return {
      dryRun,
      total: reports.length,
      created: reports.filter((r) => r.status === "created").length,
      valid: reports.filter((r) => r.status === "valid").length,
      failed: reports.filter((r) => r.status === "failed").length,
      ignoredColumns: unknown,
      rows: reports.filter((r) => r.status === "failed" || reports.length <= 200),
    };
  }
}

