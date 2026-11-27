import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { guarded, todayIst } from "../../../common/eco/http";
import { paginate, Where } from "../../../common/eco/pagination";
import { SqlService } from "../../../database/sql/sql.service";
import { AuditService } from "../../audit/application/audit.service";
import { WhatsAppService } from "../../notifications/application/whatsapp.service";
import { assertCanEdit, assertCanSee, loadDetail, lockRequest, logStatus, notifyParties } from "../../purchases/application/purchase-ledger";
import { isEditable, isPlausibleUtr, nextStatus, normalizeUtr } from "../../purchases/domain/purchase-state";
import { can, type Principal } from "../../rbac/domain/principal";
import { PrivateStorageService } from "../../uploads/application/private-storage.service";
import { NEW_ID } from "../../users-employees/application/account.service";
import type { PaymentProofDto, PaymentQueueQueryDto } from "../presentation/payments.dto";

export const PAYMENT_METHODS = ["upi", "neft", "rtgs", "imps", "bank_transfer", "cheque", "cash"] as const;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly sql: SqlService,
    private readonly audit: AuditService,
    private readonly storage: PrivateStorageService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /**
   * Attaches a payment (amount, method, date, UTR) and its proof image to a draft or a
   * request that needs correction. Earlier submissions are kept; the new one becomes the
   * only active one. A UTR already verified for another payment is refused.
   */
  async submitPayment(actor: Principal, requestId: string, dto: PaymentProofDto, file: Express.Multer.File | undefined) {
    if (!isPlausibleUtr(dto.utr)) throw new BadRequestException("Enter the transaction reference (UTR): at least 6 letters or digits");
    if (dto.paymentDate > todayIst()) throw new BadRequestException("The payment date cannot be in the future");
    // A positive amount with at most two decimals (paise).
    if (!Number.isFinite(dto.amount) || dto.amount <= 0 || dto.amount > 1e9 || Math.abs(dto.amount * 100 - Math.round(dto.amount * 100)) > 1e-6) throw new BadRequestException("Enter a valid amount (up to 2 decimals)");
    if (!file?.buffer?.length) throw new BadRequestException("The payment proof image is required (field \"file\", JPG or PNG up to 5 MB)");
    // Validates the real file type and size, then stores it privately before touching the database.
    const stored = await this.storage.storeImage(actor.companyId, "proof", actor.id, file);
    const utr = normalizeUtr(dto.utr);
    const result = await guarded(
      () =>
        this.sql.tx(async (db) => {
          const r = await lockRequest(db, actor.companyId, requestId);
          assertCanSee(actor, r);
          assertCanEdit(actor, r);
          if (!isEditable(r.status)) throw new ConflictException(`Payment details cannot change while the request is ${r.status.replace(/_/g, " ")}`);
          const verified = await db.one(`SELECT 1 FROM leads.purchase_payments WHERE company_id = $1 AND utr_normalized = $2 AND status = 'verified'`, [actor.companyId, utr]);
          if (verified) throw new ConflictException("This transaction reference was already used for a verified payment");
          const previous = await db.one<{ id: string; status: string }>(`SELECT id, status FROM leads.purchase_payments WHERE request_id = $1 AND is_active FOR UPDATE`, [requestId]);
          if (previous?.status === "verified") throw new ConflictException("This request already has a verified payment");
          if (previous) await db.exec(`UPDATE leads.purchase_payments SET is_active = false WHERE id = $1`, [previous.id]);
          const payment = await db.one<{ id: string }>(
            `INSERT INTO leads.purchase_payments (id, company_id, request_id, amount, method, payment_date, utr_raw, utr_normalized, is_active, status, submitted_by)
             VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6, $7, true, 'pending', $8) RETURNING id`,
            [actor.companyId, requestId, dto.amount, dto.method, dto.paymentDate, dto.utr.trim(), utr, actor.id],
          );
          await db.exec(`INSERT INTO leads.payment_proofs (company_id, payment_id, storage_key, mime, size_bytes, sha256, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [actor.companyId, payment!.id, stored.key, stored.mime, stored.sizeBytes, stored.sha256, actor.id]);
          await db.exec(`UPDATE leads.purchase_requests SET payment_status = 'pending' WHERE id = $1`, [requestId]);
          await db.exec(
            `INSERT INTO leads.payment_verification_logs (company_id, payment_id, request_id, action, actor_id, utr_normalized, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [actor.companyId, payment!.id, requestId, previous ? "resubmitted" : "submitted", actor.id, utr, null],
          );
          await this.audit.log(actor, previous ? "payment.resubmitted" : "payment.submitted", "purchase_payment", payment!.id, previous ? { replacedPaymentId: previous.id } : null, { requestId, amount: dto.amount, method: dto.method, paymentDate: dto.paymentDate, utr, proofKey: stored.key }, null, db);
          return loadDetail(db, actor.companyId, requestId);
        }),
      "This transaction reference is already in use",
    );
    return result;
  }

  /** Reviewer marks the request's active payment as verified (after checking the real bank record). */
  async verify(actor: Principal, requestId: string, note?: string) {
    const outcome = await guarded(
      () =>
        this.sql.tx(async (db) => {
          const r = await lockRequest(db, actor.companyId, requestId);
          const next = nextStatus(r.status, "verify_payment");
          if (!next) throw new ConflictException(`A ${r.status.replace(/_/g, " ")} request has no payment to verify`);
          const p = await db.one<any>(`SELECT * FROM leads.purchase_payments WHERE request_id = $1 AND is_active FOR UPDATE`, [requestId]);
          if (!p) throw new BadRequestException("No payment has been submitted for this request");
          if (p.status !== "pending") throw new ConflictException(`This payment is already ${p.status}`);
          await db.exec(`UPDATE leads.purchase_payments SET status = 'verified', reviewer_id = $2, reviewed_at = now(), rejection_reason = NULL WHERE id = $1`, [p.id, actor.id]);
          await db.exec(`UPDATE leads.purchase_requests SET payment_status = 'verified', status = $2 WHERE id = $1`, [requestId, next]);
          await db.exec(`INSERT INTO leads.payment_verification_logs (company_id, payment_id, request_id, action, actor_id, utr_normalized, reason) VALUES ($1, $2, $3, 'verified', $4, $5, $6)`, [actor.companyId, p.id, requestId, actor.id, p.utrNormalized, note ?? null]);
          if (r.status !== next) await logStatus(db, actor, r, r.status, next, "Payment verified");
          await this.audit.log(actor, "payment.verified", "purchase_payment", p.id, { status: "pending" }, { status: "verified", requestStatus: next }, note ?? null, db);
          return { detail: await loadDetail(db, actor.companyId, requestId), r };
        }),
      "This transaction reference was already verified for another payment",
    );
    await notifyParties(this.whatsapp, outcome.r, "payment_verified");
    return outcome.detail;
  }

  /** Reviewer rejects the payment with a mandatory reason; the request goes back for correction. */
  async reject(actor: Principal, requestId: string, reason: string) {
    const outcome = await this.sql.tx(async (db) => {
      const r = await lockRequest(db, actor.companyId, requestId);
      const next = nextStatus(r.status, "reject_payment");
      if (!next) throw new ConflictException(`A ${r.status.replace(/_/g, " ")} request has no payment to reject`);
      const p = await db.one<any>(`SELECT * FROM leads.purchase_payments WHERE request_id = $1 AND is_active FOR UPDATE`, [requestId]);
      if (!p) throw new BadRequestException("No payment has been submitted for this request");
      if (p.status !== "pending") throw new ConflictException(`This payment is already ${p.status}`);
      await db.exec(`UPDATE leads.purchase_payments SET status = 'rejected', reviewer_id = $2, reviewed_at = now(), rejection_reason = $3 WHERE id = $1`, [p.id, actor.id, reason]);
      await db.exec(`UPDATE leads.purchase_requests SET payment_status = 'rejected', status = $2 WHERE id = $1`, [requestId, next]);
      await db.exec(`INSERT INTO leads.payment_verification_logs (company_id, payment_id, request_id, action, actor_id, utr_normalized, reason) VALUES ($1, $2, $3, 'rejected', $4, $5, $6)`, [actor.companyId, p.id, requestId, actor.id, p.utrNormalized, reason]);
      await logStatus(db, actor, r, r.status, next, reason);
      await this.audit.log(actor, "payment.rejected", "purchase_payment", p.id, { status: "pending" }, { status: "rejected", requestStatus: next }, reason, db);
      return { detail: await loadDetail(db, actor.companyId, requestId), r };
    });
    await notifyParties(this.whatsapp, outcome.r, "payment_rejected", reason);
    await notifyParties(this.whatsapp, outcome.r, "correction_required", reason);
    return outcome.detail;
  }

  /**
   * The reviewer queue: active payments with their request, distributor and submitter.
   * `duplicate` lists payments whose normalized UTR also appears on another submission.
   */
  async queue(actor: Principal, query: PaymentQueueQueryDto) {
    const where = new Where().eq("p.company_id = ?", actor.companyId).eq("r.distributor_id = ?", query.distributorId);
    if (!query.includeHistory) where.raw("p.is_active");
    if (query.status === "duplicate") where.raw("EXISTS (SELECT 1 FROM leads.purchase_payments o WHERE o.company_id = p.company_id AND o.utr_normalized = p.utr_normalized AND o.id <> p.id)");
    else where.eq("p.status = ?", query.status);
    where.eq("p.created_at >= (?::date)::timestamptz", query.from).eq("p.created_at < ((?::date) + 1)::timestamptz", query.to);
    where.search(["r.request_no", "d.firm_name", "p.utr_normalized", "p.utr_raw"], query.search);
    return paginate(this.sql, {
      select: `p.id, p.request_id, r.request_no, r.status AS request_status, r.distributor_id, d.firm_name AS distributor_name, r.creator_user_id, u.name AS creator_name, r.source,
        p.amount, p.method, p.payment_date, p.utr_raw, p.utr_normalized, p.status, p.is_active, p.reviewer_id, p.reviewed_at, p.rejection_reason, p.created_at,
        (SELECT count(*)::int FROM leads.purchase_payments o WHERE o.company_id = p.company_id AND o.utr_normalized = p.utr_normalized AND o.id <> p.id) AS duplicate_count,
        EXISTS (SELECT 1 FROM leads.purchase_payments o WHERE o.company_id = p.company_id AND o.utr_normalized = p.utr_normalized AND o.id <> p.id AND o.status = 'verified') AS utr_already_verified,
        (SELECT count(*)::int FROM leads.purchase_payments o WHERE o.request_id = p.request_id) AS submission_count`,
      from: `leads.purchase_payments p JOIN leads.purchase_requests r ON r.id = p.request_id JOIN leads.distributors d ON d.id = r.distributor_id LEFT JOIN leads.lead_users u ON u.id = r.creator_user_id`,
      where,
      sorts: { createdAt: "p.created_at", amount: "p.amount", paymentDate: "p.payment_date", status: "p.status" },
      query,
      defaultOrder: "asc",
      tiebreak: "p.id",
    });
  }

  /** A short-lived link to the payment image, for reviewers and for the people who own the request. */
  async proofUrl(actor: Principal, paymentId: string) {
    const row = await this.sql.one<any>(
      `SELECT p.id, p.request_id, f.id AS proof_id, f.storage_key, r.distributor_id, r.creator_user_id, d.assigned_executive_id AS distributor_executive_id
         FROM leads.purchase_payments p JOIN leads.purchase_requests r ON r.id = p.request_id JOIN leads.distributors d ON d.id = r.distributor_id
         JOIN LATERAL (SELECT * FROM leads.payment_proofs f WHERE f.payment_id = p.id ORDER BY f.created_at DESC LIMIT 1) f ON true
        WHERE p.id = $1 AND p.company_id = $2`,
      [paymentId, actor.companyId],
    );
    if (!row) throw new NotFoundException("Payment proof not found");
    // Reviewers may open any proof; everyone else only for requests they are allowed to see (otherwise: not found).
    if (!can(actor, "payments.verify")) assertCanSee(actor, row);
    await this.audit.logQuietly(actor, "payment.proof_viewed", "purchase_payment", paymentId);
    return this.storage.signedUrl(row.storageKey);
  }
}
