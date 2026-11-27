import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { guarded, todayIst } from "../../../common/eco/http";
import { paginate, Where } from "../../../common/eco/pagination";
import { type Db, SqlService } from "../../../database/sql/sql.service";
import { AuditService } from "../../audit/application/audit.service";
import { DistributorsService } from "../../distributors/application/distributors.service";
import { scopeDistributors } from "../../distributors/domain/distributor-rules";
import { can, type Principal } from "../../rbac/domain/principal";
import { NEW_ID } from "../../users-employees/application/account.service";
import { canVisitMove, readFix } from "../domain/visit-state";
import { checkIdempotencyKey, findIdempotent, rememberIdempotent } from "../../../common/eco/idempotency";
import type { CallLogQueryDto, CheckInDto, CreateCallLogDto, CreateFollowupDto, CreateVisitDto, FollowupQueryDto, RescheduleDto, VisitQueryDto, VisitReportDto } from "../presentation/sales.dto";

const VISIT_COLS = `v.id, v.distributor_id, d.firm_name AS distributor_name, v.employee_id, e.name AS employee_name, v.visit_date, v.purpose, v.priority, v.instructions, v.status,
  v.checkin_lat, v.checkin_lng, v.checkin_accuracy, v.checkin_at, v.rescheduled_to_id, v.cancel_reason, v.created_at, v.updated_at`;
const VISIT_FROM = `leads.sales_visits v JOIN leads.distributors d ON d.id = v.distributor_id JOIN leads.employees e ON e.id = v.employee_id`;

/** Managers (who can assign visits) see the whole company's sales activity; employees only their own. */
const seesAll = (actor: Principal): boolean => can(actor, "visits.assign");

@Injectable()
export class SalesService {
  constructor(
    private readonly sql: SqlService,
    private readonly audit: AuditService,
    private readonly distributors: DistributorsService,
  ) {}

  private ownEmployee(actor: Principal): string {
    if (!actor.employeeId) throw new ForbiddenException("This action needs an employee account");
    return actor.employeeId;
  }

  // ------------------------------------------------------------------ visits
  async listVisits(actor: Principal, query: VisitQueryDto) {
    const where = new Where().eq("v.company_id = ?", actor.companyId).eq("v.status = ?", query.status).eq("v.distributor_id = ?", query.distributorId);
    where.eq("v.visit_date >= ?", query.from).eq("v.visit_date <= ?", query.to);
    where.eq("v.employee_id = ?", seesAll(actor) ? query.employeeId : (actor.employeeId ?? "none"));
    where.search(["d.firm_name", "e.name", "v.purpose"], query.search);
    return paginate(this.sql, { select: VISIT_COLS, from: VISIT_FROM, where, sorts: { visitDate: "v.visit_date", createdAt: "v.created_at", status: "v.status" }, query, tiebreak: "v.id" });
  }

  async getVisit(actor: Principal, id: string, db: Db = this.sql) {
    const where = new Where().eq("v.company_id = ?", actor.companyId).eq("v.id = ?", id);
    if (!seesAll(actor)) where.eq("v.employee_id = ?", actor.employeeId ?? "none");
    const visit = await db.one<any>(`SELECT ${VISIT_COLS} FROM ${VISIT_FROM} ${where.sql}`, where.params);
    if (!visit) throw new NotFoundException("Visit not found");
    const report = await db.one(`SELECT id, notes, transcript_lang, photos, product_requirements, next_followup_date, submitted_at FROM leads.visit_reports WHERE visit_id = $1`, [id]);
    return { ...visit, report };
  }

  createVisit(actor: Principal, dto: CreateVisitDto) {
    if (dto.visitDate < todayIst()) throw new BadRequestException("A visit cannot be scheduled in the past");
    return guarded(() =>
      this.sql.tx(async (db) => {
        const dist = await db.one<{ isActive: boolean }>(`SELECT is_active FROM leads.distributors WHERE id = $1 AND company_id = $2`, [dto.distributorId, actor.companyId]);
        if (!dist) throw new BadRequestException("Distributor not found");
        if (!dist.isActive) throw new BadRequestException("That distributor is inactive");
        const emp = await db.one(`SELECT 1 FROM leads.employees WHERE id = $1 AND company_id = $2 AND is_active`, [dto.employeeId, actor.companyId]);
        if (!emp) throw new BadRequestException("Employee not found or inactive");
        const row = await db.one<{ id: string }>(
          `INSERT INTO leads.sales_visits (id, company_id, distributor_id, employee_id, visit_date, purpose, priority, instructions, assigned_by, created_by) VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
          [actor.companyId, dto.distributorId, dto.employeeId, dto.visitDate, dto.purpose ?? null, dto.priority ?? "normal", dto.instructions ?? null, actor.id],
        );
        const created = await this.getVisit(actor, row!.id, db);
        await this.audit.log(actor, "visit.created", "sales_visit", row!.id, null, created, null, db);
        return created;
      }),
    );
  }

  /** GPS check-in, once, by the assigned employee, on the day of the visit. */
  checkIn(actor: Principal, id: string, dto: CheckInDto) {
    const employeeId = this.ownEmployee(actor);
    const fix = readFix(dto);
    if (!fix) throw new BadRequestException("A valid GPS location is required to check in. Allow location access and try again.");
    return this.sql.tx(async (db) => {
      const v = await db.one<any>(`SELECT * FROM leads.sales_visits WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
      if (!v || v.employeeId !== employeeId) throw new NotFoundException("Visit not found");
      if (!canVisitMove(v.status, "checked_in")) throw new ConflictException(`This visit is already ${v.status.replace(/_/g, " ")}`);
      if (v.visitDate !== todayIst()) throw new BadRequestException(`This visit is scheduled for ${v.visitDate}. You can only check in on the day.`);
      await db.exec(`UPDATE leads.sales_visits SET status = 'checked_in', checkin_lat = $2, checkin_lng = $3, checkin_accuracy = $4, checkin_at = $5 WHERE id = $1`, [id, fix.lat, fix.lng, fix.accuracy, fix.at]);
      await this.audit.log(actor, "visit.checked_in", "sales_visit", id, { status: v.status }, { status: "checked_in", lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, at: fix.at }, null, db);
      return this.getVisit(actor, id, db);
    });
  }

  submitReport(actor: Principal, id: string, dto: VisitReportDto) {
    const employeeId = this.ownEmployee(actor);
    for (const key of dto.photos ?? []) if (!key.startsWith(`${actor.companyId}/`)) throw new BadRequestException("A photo key is not valid for this company");
    return guarded(() =>
      this.sql.tx(async (db) => {
        const v = await db.one<any>(`SELECT * FROM leads.sales_visits WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
        if (!v || v.employeeId !== employeeId) throw new NotFoundException("Visit not found");
        if (!canVisitMove(v.status, "report_submitted")) throw new ConflictException(v.status === "scheduled" ? "Check in before submitting the report" : `This visit is already ${v.status.replace(/_/g, " ")}`);
        await db.exec(
          `INSERT INTO leads.visit_reports (company_id, visit_id, employee_id, notes, transcript_lang, photos, product_requirements, next_followup_date) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
          [actor.companyId, id, employeeId, dto.notes, dto.transcriptLang ?? null, JSON.stringify(dto.photos ?? []), JSON.stringify(dto.productRequirements ?? []), dto.nextFollowupDate ?? null],
        );
        await db.exec(`UPDATE leads.sales_visits SET status = 'report_submitted' WHERE id = $1`, [id]);
        if (dto.nextFollowupDate)
          await db.exec(`INSERT INTO leads.followups (company_id, distributor_id, employee_id, source, visit_id, due_date, notes) VALUES ($1, $2, $3, 'visit', $4, $5, $6)`, [actor.companyId, v.distributorId, employeeId, id, dto.nextFollowupDate, "Follow-up from visit report"]);
        await this.audit.log(actor, "visit.report_submitted", "sales_visit", id, { status: v.status }, { status: "report_submitted", nextFollowupDate: dto.nextFollowupDate ?? null }, null, db);
        return this.getVisit(actor, id, db);
      }),
    );
  }

  /** A manager signs off a visit whose report is in. */
  complete(actor: Principal, id: string) {
    return this.moveVisit(actor, id, "completed", "visit.completed", null);
  }

  cancel(actor: Principal, id: string, reason: string) {
    return this.moveVisit(actor, id, "cancelled", "visit.cancelled", reason);
  }

  private moveVisit(actor: Principal, id: string, to: "completed" | "cancelled", action: string, reason: string | null) {
    return this.sql.tx(async (db) => {
      const v = await db.one<any>(`SELECT status FROM leads.sales_visits WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
      if (!v) throw new NotFoundException("Visit not found");
      if (!canVisitMove(v.status, to)) throw new ConflictException(`A ${v.status.replace(/_/g, " ")} visit cannot be ${to}`);
      await db.exec(`UPDATE leads.sales_visits SET status = $2, cancel_reason = $3 WHERE id = $1`, [id, to, reason]);
      await this.audit.log(actor, action, "sales_visit", id, { status: v.status }, { status: to }, reason, db);
      return this.getVisit(actor, id, db);
    });
  }

  /** Replaces a scheduled visit with a new one on another day (or for another employee). */
  reschedule(actor: Principal, id: string, dto: RescheduleDto) {
    if (dto.visitDate < todayIst()) throw new BadRequestException("Choose today or a later date");
    return this.sql.tx(async (db) => {
      const v = await db.one<any>(`SELECT * FROM leads.sales_visits WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
      if (!v) throw new NotFoundException("Visit not found");
      if (!canVisitMove(v.status, "rescheduled")) throw new ConflictException(`A ${v.status.replace(/_/g, " ")} visit cannot be rescheduled`);
      const employeeId = dto.employeeId ?? v.employeeId;
      if (!(await db.one(`SELECT 1 FROM leads.employees WHERE id = $1 AND company_id = $2 AND is_active`, [employeeId, actor.companyId]))) throw new BadRequestException("Employee not found or inactive");
      const row = await db.one<{ id: string }>(
        `INSERT INTO leads.sales_visits (id, company_id, distributor_id, employee_id, visit_date, purpose, priority, instructions, assigned_by, created_by) VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
        [actor.companyId, v.distributorId, employeeId, dto.visitDate, v.purpose, v.priority, v.instructions, actor.id],
      );
      await db.exec(`UPDATE leads.sales_visits SET status = 'rescheduled', rescheduled_to_id = $2, cancel_reason = $3 WHERE id = $1`, [id, row!.id, dto.reason]);
      await this.audit.log(actor, "visit.rescheduled", "sales_visit", id, { status: v.status, visitDate: v.visitDate, employeeId: v.employeeId }, { status: "rescheduled", newVisitId: row!.id, visitDate: dto.visitDate, employeeId }, dto.reason, db);
      return this.getVisit(actor, row!.id, db);
    });
  }

  // --------------------------------------------------------------- follow-ups
  async listFollowups(actor: Principal, query: FollowupQueryDto) {
    const where = new Where().eq("f.company_id = ?", actor.companyId).eq("f.status = ?", query.status).eq("f.distributor_id = ?", query.distributorId);
    where.eq("f.due_date >= ?", query.from).eq("f.due_date <= ?", query.to);
    where.eq("f.employee_id = ?", seesAll(actor) ? query.employeeId : (actor.employeeId ?? "none"));
    if (query.overdue) where.raw("f.status = 'pending'").eq("f.due_date < ?", todayIst());
    where.search(["d.firm_name", "f.notes"], query.search);
    return paginate(this.sql, {
      select: "f.id, f.distributor_id, d.firm_name AS distributor_name, f.employee_id, e.name AS employee_name, f.source, f.visit_id, f.call_log_id, f.lead_id, f.due_date, f.status, f.notes, f.completed_at, f.created_at",
      from: "leads.followups f JOIN leads.distributors d ON d.id = f.distributor_id JOIN leads.employees e ON e.id = f.employee_id",
      where,
      sorts: { dueDate: "f.due_date", createdAt: "f.created_at", status: "f.status" },
      query,
      defaultOrder: "asc",
      tiebreak: "f.id",
    });
  }

  createFollowup(actor: Principal, dto: CreateFollowupDto) {
    const employeeId = dto.employeeId && seesAll(actor) ? dto.employeeId : this.ownEmployee(actor);
    if (dto.dueDate < todayIst()) throw new BadRequestException("The due date cannot be in the past");
    if (dto.source === "visit" && !dto.visitId) throw new BadRequestException("visitId is required for a visit follow-up");
    if (dto.source === "call" && !dto.callLogId) throw new BadRequestException("callLogId is required for a call follow-up");
    if (dto.source === "lead" && !dto.leadId) throw new BadRequestException("leadId is required for a lead follow-up");
    return guarded(() =>
      this.sql.tx(async (db) => {
        await this.distributors.forActor(actor, dto.distributorId, db);
        if (dto.leadId && !(await db.one(`SELECT 1 FROM leads.leads WHERE id = $1 AND company_id = $2`, [dto.leadId, actor.companyId]))) throw new BadRequestException("Lead not found");
        if (dto.visitId && !(await db.one(`SELECT 1 FROM leads.sales_visits WHERE id = $1 AND company_id = $2 AND distributor_id = $3`, [dto.visitId, actor.companyId, dto.distributorId]))) throw new BadRequestException("Visit not found for this distributor");
        if (dto.callLogId && !(await db.one(`SELECT 1 FROM leads.call_logs WHERE id = $1 AND company_id = $2 AND distributor_id = $3`, [dto.callLogId, actor.companyId, dto.distributorId]))) throw new BadRequestException("Call not found for this distributor");
        const row = await db.one<{ id: string }>(
          `INSERT INTO leads.followups (id, company_id, distributor_id, employee_id, source, visit_id, call_log_id, lead_id, due_date, notes) VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [actor.companyId, dto.distributorId, employeeId, dto.source, dto.visitId ?? null, dto.callLogId ?? null, dto.leadId ?? null, dto.dueDate, dto.notes ?? null],
        );
        await this.audit.log(actor, "followup.created", "followup", row!.id, null, { ...dto, employeeId }, null, db);
        return db.one(`SELECT * FROM leads.followups WHERE id = $1`, [row!.id]);
      }),
    );
  }

  setFollowupStatus(actor: Principal, id: string, status: "done" | "cancelled") {
    return this.sql.tx(async (db) => {
      const f = await db.one<any>(`SELECT * FROM leads.followups WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
      if (!f || (!seesAll(actor) && f.employeeId !== actor.employeeId)) throw new NotFoundException("Follow-up not found");
      if (f.status !== "pending") throw new ConflictException(`This follow-up is already ${f.status}`);
      await db.exec(`UPDATE leads.followups SET status = $2, completed_at = ${status === "done" ? "now()" : "NULL"} WHERE id = $1`, [id, status]);
      await this.audit.log(actor, status === "done" ? "followup.completed" : "followup.cancelled", "followup", id, { status: f.status }, { status }, null, db);
      return db.one(`SELECT * FROM leads.followups WHERE id = $1`, [id]);
    });
  }

  // --------------------------------------------------------------- call logs
  async listCalls(actor: Principal, query: CallLogQueryDto) {
    const where = new Where().eq("c.company_id = ?", actor.companyId).eq("c.distributor_id = ?", query.distributorId).eq("c.direction = ?", query.direction);
    where.eq("c.called_at >= (?::date)::timestamptz", query.from).eq("c.called_at < ((?::date) + 1)::timestamptz", query.to);
    where.eq("c.employee_id = ?", seesAll(actor) ? query.employeeId : (actor.employeeId ?? "none"));
    where.search(["d.firm_name", "c.notes", "c.outcome"], query.search);
    return paginate(this.sql, {
      select: "c.id, c.distributor_id, d.firm_name AS distributor_name, c.employee_id, e.name AS employee_name, c.direction, c.outcome, c.notes, c.next_followup_date, c.called_at",
      from: "leads.call_logs c JOIN leads.distributors d ON d.id = c.distributor_id JOIN leads.employees e ON e.id = c.employee_id",
      where,
      sorts: { calledAt: "c.called_at", createdAt: "c.created_at" },
      query,
      tiebreak: "c.id",
    });
  }

  createCall(actor: Principal, dto: CreateCallLogDto, idempotencyKey?: string) {
    const employeeId = dto.employeeId && seesAll(actor) ? dto.employeeId : this.ownEmployee(actor);
    const key = checkIdempotencyKey(idempotencyKey);
    return guarded(() =>
      this.sql.tx(async (db) => {
        const replay = await findIdempotent(db, "call_logs", "employee_id", employeeId, key);
        if (replay) return db.one(`SELECT * FROM leads.call_logs WHERE id = $1`, [replay]);
        // Tele/field sales may only log calls with distributors assigned to them.
        await this.distributors.forActor(actor, dto.distributorId, db);
        const row = await db.one<{ id: string }>(
          `INSERT INTO leads.call_logs (id, company_id, distributor_id, employee_id, direction, outcome, notes, next_followup_date, called_at) VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6, $7, coalesce($8::timestamptz, now())) RETURNING id`,
          [actor.companyId, dto.distributorId, employeeId, dto.direction, dto.outcome ?? null, dto.notes ?? null, dto.nextFollowupDate ?? null, dto.calledAt ?? null],
        );
        if (dto.nextFollowupDate)
          await db.exec(`INSERT INTO leads.followups (company_id, distributor_id, employee_id, source, call_log_id, due_date, notes) VALUES ($1, $2, $3, 'call', $4, $5, $6)`, [actor.companyId, dto.distributorId, employeeId, row!.id, dto.nextFollowupDate, "Follow-up from call"]);
        await rememberIdempotent(db, "call_logs", row!.id, key);
        await this.audit.log(actor, "call.logged", "call_log", row!.id, null, { distributorId: dto.distributorId, direction: dto.direction, outcome: dto.outcome ?? null }, null, db);
        return db.one(`SELECT * FROM leads.call_logs WHERE id = $1`, [row!.id]);
      }),
    );
  }

  /** Distributors the caller may pick for a visit/call (ownership applied). */
  scopeFor(actor: Principal, where: Where): void {
    scopeDistributors(actor, where);
  }
}
