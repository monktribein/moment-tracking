import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { guarded } from "../../../common/eco/http";
import { paginate, Where } from "../../../common/eco/pagination";
import { type Db, SqlService } from "../../../database/sql/sql.service";
import { AuditService } from "../../audit/application/audit.service";
import { DistributorsService } from "../../distributors/application/distributors.service";
import { ASSIGNED_ONLY_ROLES } from "../../distributors/domain/distributor-rules";
import { WhatsAppService } from "../../notifications/application/whatsapp.service";
import { can, type Principal } from "../../rbac/domain/principal";
import { NEW_ID } from "../../users-employees/application/account.service";
import { isEditable, itemsProblem, nextStatus, type PurchaseAction } from "../domain/purchase-state";
import type { CreatePurchaseDto, ItemDto, PurchaseQueryDto, UpdateDraftDto } from "../presentation/purchases.dto";
import { assertCanEdit, assertCanSee, loadDetail, lockRequest, logStatus, notifyParties, type RequestRow } from "./purchase-ledger";

const PAST: Record<PurchaseAction, string> = { submit: "submitted", verify_payment: "verified", reject_payment: "rejected", resubmit: "resubmitted", approve: "approved", reject: "rejected", cancel: "cancelled", process: "processed" };

@Injectable()
export class PurchasesService {
  constructor(
    private readonly sql: SqlService,
    private readonly audit: AuditService,
    private readonly distributors: DistributorsService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  // ------------------------------------------------------------------- reads
  async list(actor: Principal, query: PurchaseQueryDto) {
    const where = new Where().eq("r.company_id = ?", actor.companyId).eq("r.status = ?", query.status).eq("r.payment_status = ?", query.paymentStatus).eq("r.source = ?", query.source).eq("r.creator_user_id = ?", query.creatorId);
    where.eq("r.created_at >= (?::date)::timestamptz", query.from).eq("r.created_at < ((?::date) + 1)::timestamptz", query.to);
    if (actor.role === "distributor") where.eq("r.distributor_id = ?", actor.distributorId ?? "none");
    else {
      where.eq("r.distributor_id = ?", query.distributorId);
      if (ASSIGNED_ONLY_ROLES.includes(actor.role)) {
        const me = where.param(actor.id);
        const emp = where.param(actor.employeeId ?? "none");
        where.raw(`(r.creator_user_id = ${me} OR d.assigned_executive_id = ${emp})`);
      }
    }
    where.search(["r.request_no", "d.firm_name"], query.search);
    return paginate(this.sql, {
      select: `r.id, r.request_no, r.distributor_id, d.firm_name AS distributor_name, r.source, r.creator_user_id, u.name AS creator_name, r.status, r.payment_status, r.version, r.external_invoice_ref,
        r.submitted_at, r.approved_at, r.processed_at, r.created_at, r.updated_at,
        (SELECT count(*)::int FROM leads.purchase_request_items i WHERE i.request_id = r.id) AS item_count,
        (SELECT coalesce(sum(i.quantity), 0)::int FROM leads.purchase_request_items i WHERE i.request_id = r.id) AS total_quantity`,
      from: "leads.purchase_requests r JOIN leads.distributors d ON d.id = r.distributor_id LEFT JOIN leads.lead_users u ON u.id = r.creator_user_id",
      where,
      sorts: { createdAt: "r.created_at", requestNo: "r.request_no", status: "r.status", submittedAt: "r.submitted_at" },
      query,
      tiebreak: "r.id",
    });
  }

  async get(actor: Principal, id: string) {
    const detail = await loadDetail(this.sql, actor.companyId, id);
    assertCanSee(actor, detail);
    return detail;
  }

  async history(actor: Principal, id: string) {
    const request = await this.get(actor, id);
    const [statusLog, versions, payments] = await Promise.all([
      this.sql.all(`SELECT l.id, l.from_status, l.to_status, l.actor_id, u.name AS actor_name, l.reason, l.at FROM leads.purchase_status_logs l LEFT JOIN leads.lead_users u ON u.id = l.actor_id WHERE l.request_id = $1 ORDER BY l.at, l.id`, [id]),
      this.sql.all(`SELECT v.id, v.version, v.snapshot, v.changed_by, v.reason, v.created_at FROM leads.purchase_request_versions v WHERE v.request_id = $1 ORDER BY v.version`, [id]),
      this.sql.all(
        `SELECT p.id, p.amount, p.method, p.payment_date, p.utr_raw, p.status, p.is_active, p.reviewer_id, p.reviewed_at, p.rejection_reason, p.created_at
           FROM leads.purchase_payments p WHERE p.request_id = $1 ORDER BY p.created_at`,
        [id],
      ),
    ]);
    const verificationLog = can(actor, "payments.verify") || actor.role === "admin" ? await this.sql.all(`SELECT id, payment_id, action, actor_id, utr_normalized, reason, at FROM leads.payment_verification_logs WHERE request_id = $1 ORDER BY at, id`, [id]) : undefined;
    return { requestNo: request.requestNo, status: request.status, statusLog, versions, payments, verificationLog };
  }

  // ------------------------------------------------------------------ writes
  /** Resolves product ids to active products and freezes name/model/sku in the line. */
  private async buildItems(db: Db, companyId: string, items: ItemDto[]) {
    const problem = itemsProblem(items);
    if (problem) throw new BadRequestException(problem);
    const products = await db.all<any>(`SELECT id, product_code, category, name, model, sku, is_active FROM leads.products WHERE company_id = $1 AND id = ANY($2::text[])`, [companyId, items.map((i) => i.productId)]);
    const byId = new Map(products.map((p) => [p.id, p]));
    return items.map((item) => {
      const p = byId.get(item.productId);
      if (!p) throw new BadRequestException("A product in the list does not exist");
      if (!p.isActive) throw new BadRequestException(`${p.name} (${p.sku}) is not active and cannot be ordered`);
      return { productId: p.id, quantity: item.quantity, remarks: item.remarks ?? null, snapshot: { name: p.name, model: p.model, sku: p.sku, category: p.category, productCode: p.productCode } };
    });
  }

  private async writeItems(db: Db, companyId: string, requestId: string, items: Awaited<ReturnType<PurchasesService["buildItems"]>>) {
    await db.exec(`DELETE FROM leads.purchase_request_items WHERE request_id = $1`, [requestId]);
    for (const i of items)
      await db.exec(`INSERT INTO leads.purchase_request_items (company_id, request_id, product_id, product_snapshot, quantity, remarks) VALUES ($1, $2, $3, $4::jsonb, $5, $6)`, [companyId, requestId, i.productId, JSON.stringify(i.snapshot), i.quantity, i.remarks]);
  }

  /**
   * Creates a draft. The distributor of a distributor login is taken from the login (any
   * other value is refused); employees pick a distributor they are authorized for. Sending the
   * same Idempotency-Key again returns the request created the first time.
   */
  async create(actor: Principal, dto: CreatePurchaseDto, idempotencyKey?: string) {
    if (idempotencyKey !== undefined && (idempotencyKey.length < 8 || idempotencyKey.length > 128)) throw new BadRequestException("Idempotency-Key must be 8 to 128 characters");
    let distributorId: string;
    let source: string;
    if (actor.role === "distributor") {
      if (!actor.distributorId) throw new ForbiddenException("This login is not linked to a distributor");
      if (dto.distributorId && dto.distributorId !== actor.distributorId) throw new ForbiddenException("You can only create requests for your own distributor account");
      distributorId = actor.distributorId;
      source = "portal";
    } else {
      if (!dto.distributorId) throw new BadRequestException("Choose a distributor");
      distributorId = dto.distributorId;
      source = dto.source ?? "web";
    }
    const existing = idempotencyKey ? await this.byKey(actor, idempotencyKey) : null;
    if (existing) return { request: existing, replayed: true };
    try {
      const request = await this.sql.tx(async (db) => {
        const dist = await this.distributors.forActor(actor, distributorId, db);
        if (!dist.isActive) throw new BadRequestException("This distributor is inactive");
        const items = await this.buildItems(db, actor.companyId, dto.items);
        const no = await db.one<{ n: string }>(`SELECT leads.next_doc_no($1, 'PR') AS n`, [actor.companyId]);
        const row = await db.one<{ id: string }>(
          `INSERT INTO leads.purchase_requests (id, company_id, request_no, distributor_id, source, creator_user_id, status, remarks, idempotency_key)
           VALUES (${NEW_ID}, $1, $2, $3, $4, $5, 'draft', $6, $7) RETURNING id`,
          [actor.companyId, no!.n, distributorId, source, actor.id, dto.remarks ?? null, idempotencyKey ?? null],
        );
        await this.writeItems(db, actor.companyId, row!.id, items);
        await logStatus(db, actor, { id: row!.id, companyId: actor.companyId }, null, "draft", "Created");
        const detail = await loadDetail(db, actor.companyId, row!.id);
        await this.audit.log(actor, "purchase.created", "purchase_request", row!.id, null, { requestNo: no!.n, distributorId, source, items: dto.items }, null, db);
        return detail;
      });
      return { request, replayed: false };
    } catch (error) {
      // Two identical requests raced: the loser gets the winner's request.
      if ((error as { code?: string }).code === "23505" && idempotencyKey) {
        const winner = await this.byKey(actor, idempotencyKey);
        if (winner) return { request: winner, replayed: true };
      }
      throw error;
    }
  }

  private async byKey(actor: Principal, key: string) {
    const row = await this.sql.one<{ id: string; creatorUserId: string }>(`SELECT id, creator_user_id FROM leads.purchase_requests WHERE company_id = $1 AND idempotency_key = $2`, [actor.companyId, key]);
    if (!row) return null;
    if (row.creatorUserId !== actor.id) throw new ConflictException("That Idempotency-Key was used by someone else");
    return loadDetail(this.sql, actor.companyId, row.id);
  }

  /** Edits items and remarks of a draft, or of a request sent back for correction. Approved and processed records are frozen. */
  updateDraft(actor: Principal, id: string, dto: UpdateDraftDto) {
    return this.sql.tx(async (db) => {
      const r = await lockRequest(db, actor.companyId, id);
      assertCanSee(actor, r);
      assertCanEdit(actor, r);
      if (!isEditable(r.status)) throw new ConflictException(`A ${r.status.replace(/_/g, " ")} request cannot be edited`);
      const before = await loadDetail(db, actor.companyId, id);
      if (dto.items) await this.writeItems(db, actor.companyId, id, await this.buildItems(db, actor.companyId, dto.items));
      if (dto.remarks !== undefined) await db.exec(`UPDATE leads.purchase_requests SET remarks = $2 WHERE id = $1`, [id, dto.remarks]);
      const after = await loadDetail(db, actor.companyId, id);
      await this.audit.log(actor, "purchase.draft_updated", "purchase_request", id, { items: before.items, remarks: before.remarks }, { items: after.items, remarks: after.remarks }, null, db);
      return after;
    });
  }

  /** Locks the request, checks the transition, runs `apply`, writes the status log and the audit entry. */
  private async transition(
    actor: Principal,
    id: string,
    action: PurchaseAction,
    reason: string | null,
    guard: (db: Db, r: RequestRow) => Promise<void> | void,
    apply: (db: Db, r: RequestRow, next: string) => Promise<void>,
    options: { visibility?: boolean } = {},
  ) {
    return guarded(() => this.sql.tx(async (db) => {
      const r = await lockRequest(db, actor.companyId, id);
      if (options.visibility !== false) assertCanSee(actor, r);
      const next = nextStatus(r.status, action);
      if (!next) throw new ConflictException(`The request is ${r.status.replace(/_/g, " ")} and cannot be ${PAST[action]}`);
      await guard(db, r);
      // The action's own columns (approved_by, processed_at, rejection_reason ...) are written first: the table's CHECK rules require them before the new status.
      await apply(db, r, next);
      await db.exec(`UPDATE leads.purchase_requests SET status = $2 WHERE id = $1`, [id, next]);
      await logStatus(db, actor, r, r.status, next, reason);
      await this.audit.log(actor, `purchase.${action}`, "purchase_request", id, { status: r.status, paymentStatus: r.paymentStatus }, { status: next }, reason, db);
      return { detail: await loadDetail(db, actor.companyId, id), r };
    }));
  }

  /** draft -> submitted. Needs items and a payment with its proof. Repeating it on an already-submitted request is a harmless no-op. */
  async submit(actor: Principal, id: string) {
    const current = await this.sql.one<{ status: string }>(`SELECT status FROM leads.purchase_requests WHERE id = $1 AND company_id = $2`, [id, actor.companyId]);
    if (current && ["submitted", "under_review"].includes(current.status)) return { request: await this.get(actor, id), replayed: true };
    const out = await this.transition(
      actor,
      id,
      "submit",
      null,
      async (db, r) => {
        assertCanEdit(actor, r);
        const items = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM leads.purchase_request_items WHERE request_id = $1`, [id]);
        if (!items?.n) throw new BadRequestException("Add at least one item before submitting");
        const proof = await db.one(`SELECT 1 FROM leads.purchase_payments p JOIN leads.payment_proofs f ON f.payment_id = p.id WHERE p.request_id = $1 AND p.is_active AND length(p.utr_normalized) >= 6`, [id]);
        if (!proof) throw new BadRequestException("The payment details (amount, method, date, UTR) and proof image are required before submitting");
      },
      async (db, r) => {
        await db.exec(`UPDATE leads.purchase_requests SET submitted_at = now() WHERE id = $1`, [id]);
        await this.snapshot(db, actor, r.id, r.companyId, r.version, "Submitted");
      },
    );
    await notifyParties(this.whatsapp, out.r, "request_submitted");
    if (actor.role !== "distributor") await notifyParties(this.whatsapp, out.r, "request_received");
    return { request: out.detail, replayed: false };
  }

  /** Stores the request as submitted (header, items, active payment) so earlier versions are never lost. */
  private async snapshot(db: Db, actor: Principal, requestId: string, companyId: string, version: number, reason: string) {
    const detail = await loadDetail(db, companyId, requestId);
    await db.exec(`INSERT INTO leads.purchase_request_versions (company_id, request_id, version, snapshot, changed_by, reason) VALUES ($1, $2, $3, $4::jsonb, $5, $6) ON CONFLICT (request_id, version) DO NOTHING`, [companyId, requestId, version, JSON.stringify({ remarks: detail.remarks, items: detail.items, payment: detail.payment, status: detail.status }), actor.id, reason]);
  }

  /** correction_required -> under_review with a new version; the previous version stays in the history. */
  async resubmit(actor: Principal, id: string) {
    const out = await this.transition(
      actor,
      id,
      "resubmit",
      "Resubmitted after correction",
      async (db, r) => {
        assertCanEdit(actor, r);
        const items = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM leads.purchase_request_items WHERE request_id = $1`, [id]);
        if (!items?.n) throw new BadRequestException("The request has no items");
        const p = await db.one<{ status: string }>(`SELECT status FROM leads.purchase_payments WHERE request_id = $1 AND is_active`, [id]);
        if (!p || p.status !== "pending") throw new BadRequestException("Submit the corrected payment details and proof before resubmitting");
      },
      async (db, r) => {
        await db.exec(`UPDATE leads.purchase_requests SET version = version + 1, payment_status = 'pending' WHERE id = $1`, [id]);
        await this.snapshot(db, actor, r.id, r.companyId, r.version + 1, "Resubmitted after correction");
      },
    );
    return out.detail;
  }

  async cancel(actor: Principal, id: string, reason: string | null) {
    const out = await this.transition(actor, id, "cancel", reason, (_db, r) => {
      // The creator (or the distributor it belongs to) may cancel their own request; reviewers may cancel any.
      if (!can(actor, "purchases.approve") && !can(actor, "purchases.review")) assertCanEdit(actor, r);
    }, async () => undefined);
    return out.detail;
  }

  /** The order is declined (separate from payment verification). A reason is mandatory. */
  async reject(actor: Principal, id: string, reason: string) {
    const out = await this.transition(actor, id, "reject", reason, () => undefined, async (db) => {
      await db.exec(`UPDATE leads.purchase_requests SET rejection_reason = $2 WHERE id = $1`, [id, reason]);
    });
    await notifyParties(this.whatsapp, out.r, "request_rejected", reason);
    return out.detail;
  }

  /**
   * Approval: only a request under review whose active payment is verified. Runs in one
   * transaction with the request row locked, so two approvers (or an approval racing a
   * payment rejection) cannot both succeed.
   */
  async approve(actor: Principal, id: string) {
    const out = await this.transition(
      actor,
      id,
      "approve",
      null,
      async (db, r) => {
        if (r.paymentStatus !== "verified") throw new ConflictException("Verify the payment before approving the request");
        const p = await db.one<{ status: string }>(`SELECT status FROM leads.purchase_payments WHERE request_id = $1 AND is_active FOR UPDATE`, [id]);
        if (!p || p.status !== "verified") throw new ConflictException("The active payment is not verified");
        const items = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM leads.purchase_request_items WHERE request_id = $1`, [id]);
        if (!items?.n) throw new BadRequestException("The request has no items");
      },
      async (db) => {
        await db.exec(`UPDATE leads.purchase_requests SET approved_by = $2, approved_at = now() WHERE id = $1`, [id, actor.id]);
      },
    );
    await notifyParties(this.whatsapp, out.r, "request_approved");
    return out.detail;
  }

  /** The invoice is raised outside the system; this records that the approved request is done. */
  async process(actor: Principal, id: string, invoiceRef?: string) {
    const out = await this.transition(actor, id, "process", invoiceRef ? `Invoice ${invoiceRef}` : null, () => undefined, async (db) => {
      await db.exec(`UPDATE leads.purchase_requests SET processed_by = $2, processed_at = now(), external_invoice_ref = coalesce($3, external_invoice_ref) WHERE id = $1`, [id, actor.id, invoiceRef ?? null]);
    });
    await notifyParties(this.whatsapp, out.r, "request_processed", invoiceRef);
    return out.detail;
  }

}
