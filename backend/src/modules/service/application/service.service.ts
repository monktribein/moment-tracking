import { BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { guarded, todayIst } from "../../../common/eco/http";
import { generateOtp, hashOtp, matchesOtp, otpPolicy, otpUsable } from "../../../common/eco/otp";
import { type Db, SqlService } from "../../../database/sql/sql.service";
import { AuditService } from "../../audit/application/audit.service";
import { assertCanSeeComplaint, complaintDetail, type ComplaintRow, loadComplaint, logComplaintStatus } from "../../customers-complaints/application/complaint-ledger";
import { type ComplaintAction, nextComplaintStatus } from "../../customers-complaints/domain/complaint-state";
import { WhatsAppService } from "../../notifications/application/whatsapp.service";
import type { Principal } from "../../rbac/domain/principal";
import { can } from "../../rbac/domain/principal";
import { readFix } from "../../sales/domain/visit-state";
import { NEW_ID } from "../../users-employees/application/account.service";
import type { AssignDto, ReassignDto, ServiceCheckInDto, ServiceReportDto } from "../presentation/service.dto";

const PAST: Record<ComplaintAction, string> = { assign: "assigned", reassign: "reassigned", check_in: "checked in", report_resolved: "reported", report_pending: "reported", close: "closed", reopen: "reopened" };

/** How long after a verified OTP the complaint can still be closed. */
const closeWindowMinutes = (): number => (Number(process.env.OTP_CLOSE_WINDOW_MINUTES) > 0 ? Number(process.env.OTP_CLOSE_WINDOW_MINUTES) : 30);

@Injectable()
export class ServiceService {
  private readonly policy = otpPolicy();

  constructor(
    private readonly sql: SqlService,
    private readonly audit: AuditService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /** Support managers (and admin) act on any complaint; an engineer only on the one assigned to them. */
  private assertEngineerOrManager(actor: Principal, c: ComplaintRow): void {
    if (can(actor, "complaints.assign")) return;
    if (!actor.employeeId || c.engineerId !== actor.employeeId) throw new ForbiddenException("This complaint is not assigned to you");
  }

  private async assertEngineer(db: Db, companyId: string, engineerId: string): Promise<void> {
    const e = await db.one<{ role: string }>(`SELECT r.code AS role FROM leads.employees e JOIN leads.roles r ON r.id = e.role_id WHERE e.id = $1 AND e.company_id = $2 AND e.is_active`, [engineerId, companyId]);
    if (!e) throw new BadRequestException("Engineer not found or inactive");
    if (e.role !== "field_support") throw new BadRequestException("Only field support engineers can be assigned to a complaint");
  }

  private async notifyCustomer(c: ComplaintRow, event: "engineer_assigned" | "complaint_status_changed" | "complaint_closed", status: string, extra?: string) {
    await this.whatsapp.notify({ companyId: c.companyId, event, mobile: c.customerMobile, userId: c.customerUserId, title: `Complaint ${c.complaintNo}`, body: `Status: ${status.replace(/_/g, " ")}${extra ? ` (${extra})` : ""}`, params: [c.customerName, c.complaintNo, status.replace(/_/g, " "), ...(extra ? [extra] : [])], entity: "complaint", entityId: c.id });
  }

  /** Locks the complaint, checks the transition, applies it, writes the status log and the audit entry. */
  private async run<T>(
    actor: Principal,
    id: string,
    action: ComplaintAction,
    reason: string | null,
    body: (db: Db, c: ComplaintRow, next: string) => Promise<T>,
    options: { check?: "engineerOrManager" | "manager" | "none"; statusFirst?: boolean } = {},
  ): Promise<{ result: T; c: ComplaintRow; next: string }> {
    return guarded(() => this.sql.tx(async (db) => {
      const c = await loadComplaint(db, actor.companyId, id, true);
      assertCanSeeComplaint(actor, c);
      if (options.check === "engineerOrManager") this.assertEngineerOrManager(actor, c);
      const next = nextComplaintStatus(c.status, action);
      if (!next) throw new ConflictException(`The complaint is ${c.status.replace(/_/g, " ")} and cannot be ${PAST[action]}`);
      // Closing needs closed_at before the status (a CHECK rule); reopening clears closed_at, so the status moves first.
      if (options.statusFirst) await db.exec(`UPDATE leads.complaints SET status = $2 WHERE id = $1`, [id, next]);
      const result = await body(db, c, next);
      if (!options.statusFirst) await db.exec(`UPDATE leads.complaints SET status = $2 WHERE id = $1`, [id, next]);
      await logComplaintStatus(db, actor, c, c.status, next, reason);
      await this.audit.log(actor, `complaint.${action}`, "complaint", id, { status: c.status }, { status: next }, reason, db);
      return { result, c, next };
    }));
  }

  // ------------------------------------------------------------ assignment
  private async placeAssignment(db: Db, actor: Principal, c: ComplaintRow, dto: AssignDto, reason: string | null) {
    await this.assertEngineer(db, actor.companyId, dto.engineerId);
    if (dto.scheduledDate && dto.scheduledDate < todayIst()) throw new BadRequestException("The visit cannot be scheduled in the past");
    // The current assignment ends; its open visit is cancelled.
    await db.exec(`UPDATE leads.complaint_assignments SET is_current = false, unassigned_at = now() WHERE complaint_id = $1 AND is_current`, [c.id]);
    await db.exec(`UPDATE leads.service_visits SET status = 'cancelled' WHERE complaint_id = $1 AND status IN ('scheduled','checked_in')`, [c.id]);
    const a = await db.one<{ id: string }>(
      `INSERT INTO leads.complaint_assignments (id, company_id, complaint_id, engineer_id, assigned_by, scheduled_date, reason) VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6) RETURNING id`,
      [actor.companyId, c.id, dto.engineerId, actor.id, dto.scheduledDate ?? null, reason ?? dto.note ?? null],
    );
    await db.exec(`INSERT INTO leads.service_visits (company_id, complaint_id, assignment_id, engineer_id, scheduled_date) VALUES ($1, $2, $3, $4, $5)`, [actor.companyId, c.id, a!.id, dto.engineerId, dto.scheduledDate ?? null]);
    return a!.id;
  }

  async assign(actor: Principal, id: string, dto: AssignDto) {
    const out = await guarded(() => this.run(actor, id, "assign", dto.note ?? null, (db, c) => this.placeAssignment(db, actor, c, dto, null)));
    await this.notifyCustomer(out.c, "engineer_assigned", "assigned");
    return this.detail(actor, id);
  }

  async reassign(actor: Principal, id: string, dto: ReassignDto) {
    const out = await guarded(() => this.run(actor, id, "reassign", dto.reason, (db, c) => this.placeAssignment(db, actor, c, dto, dto.reason)));
    await this.notifyCustomer(out.c, "engineer_assigned", "reassigned");
    return this.detail(actor, id);
  }

  // --------------------------------------------------------------- field work
  async checkIn(actor: Principal, id: string, dto: ServiceCheckInDto) {
    const fix = readFix(dto);
    if (!fix) throw new BadRequestException("A valid GPS location is required to check in. Allow location access and try again.");
    const out = await this.run(
      actor,
      id,
      "check_in",
      null,
      async (db, c) => {
        if (!actor.employeeId || c.engineerId !== actor.employeeId) throw new ForbiddenException("This complaint is not assigned to you");
        const visit = await db.one<{ id: string }>(`SELECT id FROM leads.service_visits WHERE complaint_id = $1 AND engineer_id = $2 AND status = 'scheduled' ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [c.id, actor.employeeId]);
        const visitId =
          visit?.id ??
          (await db.one<{ id: string }>(`INSERT INTO leads.service_visits (company_id, complaint_id, assignment_id, engineer_id, scheduled_date) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [c.companyId, c.id, c.assignmentId, actor.employeeId, todayIst()]))!.id;
        await db.exec(`UPDATE leads.service_visits SET status = 'checked_in', checkin_lat = $2, checkin_lng = $3, checkin_accuracy = $4, checkin_at = $5 WHERE id = $1`, [visitId, fix.lat, fix.lng, fix.accuracy, fix.at]);
        return visitId;
      },
      { check: "none" },
    );
    await this.notifyCustomer(out.c, "complaint_status_changed", "in_progress");
    return this.detail(actor, id);
  }

  /** The engineer's report ends the visit: the job is resolved (then the OTP closes it) or stays pending with further action. */
  async serviceReport(actor: Principal, id: string, dto: ServiceReportDto) {
    for (const key of dto.photos ?? []) if (!key.startsWith(`${actor.companyId}/`)) throw new BadRequestException("A photo key is not valid for this company");
    const action: ComplaintAction = dto.outcome === "resolved" ? "report_resolved" : "report_pending";
    const out = await this.run(
      actor,
      id,
      action,
      dto.furtherAction ?? null,
      async (db, c) => {
        if (!actor.employeeId || c.engineerId !== actor.employeeId) throw new ForbiddenException("This complaint is not assigned to you");
        const visit = await db.one<{ id: string }>(`SELECT id FROM leads.service_visits WHERE complaint_id = $1 AND engineer_id = $2 AND status = 'checked_in' ORDER BY checkin_at DESC LIMIT 1 FOR UPDATE`, [c.id, actor.employeeId]);
        if (!visit) throw new BadRequestException("Check in at the customer's location before submitting the report");
        await db.exec(
          `INSERT INTO leads.service_reports (company_id, complaint_id, visit_id, engineer_id, diagnosis, action_taken, notes, transcript_lang, photos, further_action) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
          [c.companyId, c.id, visit.id, actor.employeeId, dto.diagnosis, dto.actionTaken, dto.notes ?? null, dto.transcriptLang ?? null, JSON.stringify(dto.photos ?? []), dto.furtherAction ?? null],
        );
        await db.exec(`UPDATE leads.service_visits SET status = 'completed' WHERE id = $1`, [visit.id]);
        if (dto.outcome === "resolved") await db.exec(`UPDATE leads.complaints SET resolved_at = now() WHERE id = $1`, [c.id]);
      },
      { check: "none" },
    );
    await this.notifyCustomer(out.c, "complaint_status_changed", out.next);
    return this.detail(actor, id);
  }

  // ---------------------------------------------------------------- OTP
  /**
   * Creates a single-use 6-digit code for a resolved complaint and sends it to the customer by
   * WhatsApp. The code is stored only as a bcrypt hash and is never returned by the API. At
   * most 3 codes an hour per complaint; a new code replaces the previous one.
   */
  async sendOtp(actor: Principal, id: string) {
    const p = this.policy;
    const otp = generateOtp(p.length);
    const otpHash = await hashOtp(otp, p.bcryptRounds);
    const { c, otpId, expiresAt } = await this.sql.tx(async (db) => {
      const c = await loadComplaint(db, actor.companyId, id, true);
      assertCanSeeComplaint(actor, c);
      this.assertEngineerOrManager(actor, c);
      if (c.status !== "resolved") throw new ConflictException("The OTP can be requested only after the service report marks the complaint resolved");
      const recent = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM leads.otp_verifications WHERE complaint_id = $1 AND created_at > now() - interval '1 hour'`, [id]);
      if ((recent?.n ?? 0) >= p.maxSendsPerHour) throw new HttpException(`The OTP was already sent ${p.maxSendsPerHour} times in the last hour. Try again later.`, HttpStatus.TOO_MANY_REQUESTS);
      await db.exec(`UPDATE leads.otp_verifications SET invalidated_at = now() WHERE complaint_id = $1 AND verified_at IS NULL AND invalidated_at IS NULL`, [id]);
      const row = await db.one<{ id: string; expiresAt: Date }>(
        `INSERT INTO leads.otp_verifications (id, company_id, complaint_id, otp_hash, expires_at, max_attempts, sent_count, requested_by)
         VALUES (${NEW_ID}, $1, $2, $3, now() + ($4::double precision * interval '1 minute'), $5, $6, $7) RETURNING id, expires_at`,
        [actor.companyId, id, otpHash, p.ttlMinutes, p.maxAttempts, (recent?.n ?? 0) + 1, actor.id],
      );
      await this.audit.log(actor, "complaint.otp_sent", "complaint", id, null, { otpId: row!.id, sendsLastHour: (recent?.n ?? 0) + 1 }, null, db);
      return { c, otpId: row!.id, expiresAt: row!.expiresAt };
    });
    const sent = await this.whatsapp.notify({ companyId: c.companyId, event: "service_otp", mobile: c.customerMobile, otp, entity: "complaint", entityId: id });
    const status = sent.status === "sent" ? "sent" : "failed";
    await this.sql.exec(`UPDATE leads.otp_verifications SET delivery_status = $2 WHERE id = $1`, [otpId, status]);
    if (status === "failed") throw new HttpException("The OTP could not be delivered to the customer's WhatsApp. Try again.", HttpStatus.BAD_GATEWAY);
    return { sent: true, expiresAt, expiresInMinutes: p.ttlMinutes, deliveryStatus: status };
  }

  /** The customer reads the code to the engineer, who enters it here. Wrong guesses are counted; 5 lock the code. */
  async verifyOtp(actor: Principal, id: string, otp: string) {
    const outcome = await this.sql.tx(async (db) => {
      const c = await loadComplaint(db, actor.companyId, id, true);
      assertCanSeeComplaint(actor, c);
      this.assertEngineerOrManager(actor, c);
      const row = await db.one<any>(`SELECT * FROM leads.otp_verifications WHERE complaint_id = $1 AND verified_at IS NULL AND invalidated_at IS NULL FOR UPDATE`, [id]);
      if (!row) return { result: "none" as const, left: 0 };
      const state = otpUsable(row);
      if (state !== "ok") return { result: state, left: 0 };
      const match = await matchesOtp(otp, row.otpHash);
      await db.exec(`UPDATE leads.otp_verifications SET attempts = attempts + 1, verified_at = ${match ? "now()" : "NULL"} WHERE id = $1`, [row.id]);
      if (match) await this.audit.log(actor, "complaint.otp_verified", "complaint", id, null, { otpId: row.id }, null, db);
      return { result: match ? ("match" as const) : ("wrong" as const), left: row.maxAttempts - row.attempts - 1 };
    });
    if (outcome.result === "match") return { verified: true };
    const text: Record<string, string> = {
      none: "No OTP is waiting. Request a new one.",
      expired: "This OTP has expired. Request a new one.",
      locked: "Too many wrong attempts. Request a new OTP.",
      used: "This OTP was already used.",
      undelivered: "The OTP could not be delivered. Request a new one.",
      wrong: `The OTP is incorrect. ${outcome.left} attempt(s) left.`,
    };
    throw new BadRequestException(text[outcome.result]);
  }

  /** Closes a resolved complaint, only after the customer's OTP was verified. The verified code is consumed (single use). */
  async close(actor: Principal, id: string) {
    const out = await this.run(
      actor,
      id,
      "close",
      "Closed with verified customer OTP",
      async (db, c) => {
        this.assertEngineerOrManager(actor, c);
        const otp = await db.one<{ id: string }>(
          `SELECT id FROM leads.otp_verifications WHERE complaint_id = $1 AND verified_at IS NOT NULL AND invalidated_at IS NULL AND verified_at > now() - ($2::double precision * interval '1 minute') ORDER BY verified_at DESC LIMIT 1 FOR UPDATE`,
          [id, closeWindowMinutes()],
        );
        if (!otp) throw new ForbiddenException("The customer's OTP must be verified before the complaint can be closed");
        await db.exec(`UPDATE leads.otp_verifications SET invalidated_at = now() WHERE id = $1`, [otp.id]);
        await db.exec(`UPDATE leads.complaints SET closed_at = now() WHERE id = $1`, [id]);
      },
      { check: "none" },
    );
    await this.notifyCustomer(out.c, "complaint_closed", "closed");
    return this.detail(actor, id);
  }

  /** A customer (own complaint) or support staff can reopen a resolved or closed complaint with a reason. */
  async reopen(actor: Principal, id: string, reason: string) {
    if (actor.role !== "customer" && !can(actor, "complaints.assign")) throw new ForbiddenException("Not allowed");
    const out = await this.run(
      actor,
      id,
      "reopen",
      reason,
      async (db) => {
        await db.exec(`UPDATE leads.complaints SET reopen_count = reopen_count + 1, closed_at = NULL, resolved_at = NULL WHERE id = $1`, [id]);
        await db.exec(`UPDATE leads.complaint_assignments SET is_current = false, unassigned_at = now() WHERE complaint_id = $1 AND is_current`, [id]);
        await db.exec(`UPDATE leads.otp_verifications SET invalidated_at = now() WHERE complaint_id = $1 AND invalidated_at IS NULL`, [id]);
      },
      { check: "none", statusFirst: true },
    );
    await this.notifyCustomer(out.c, "complaint_status_changed", "reopened");
    return this.detail(actor, id);
  }

  private async detail(actor: Principal, id: string) {
    const c = await loadComplaint(this.sql, actor.companyId, id);
    assertCanSeeComplaint(actor, c);
    return complaintDetail(this.sql, actor.companyId, id);
  }
}

