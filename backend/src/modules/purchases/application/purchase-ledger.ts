import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { Db } from "../../../database/sql/sql.service";
import { ASSIGNED_ONLY_ROLES } from "../../distributors/domain/distributor-rules";
import type { Principal } from "../../rbac/domain/principal";
import type { WhatsAppEvent } from "../../notifications/domain/whatsapp.types";
import type { WhatsAppService } from "../../notifications/application/whatsapp.service";

export interface RequestRow {
  id: string;
  companyId: string;
  requestNo: string;
  distributorId: string;
  source: string;
  creatorUserId: string;
  status: string;
  paymentStatus: string;
  remarks: string | null;
  externalInvoiceRef: string | null;
  version: number;
  idempotencyKey: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  processedAt: Date | null;
  rejectionReason: string | null;
  distributorExecutiveId: string | null;
  distributorMobile: string;
  distributorName: string;
}

const REQUEST_SQL = `SELECT r.*, d.assigned_executive_id AS distributor_executive_id, d.mobile AS distributor_mobile, d.firm_name AS distributor_name
  FROM leads.purchase_requests r JOIN leads.distributors d ON d.id = r.distributor_id`;

/** Loads a request and locks its row (FOR UPDATE) for the rest of the transaction. */
export async function lockRequest(db: Db, companyId: string, id: string): Promise<RequestRow> {
  const row = await db.one<RequestRow>(`${REQUEST_SQL} WHERE r.id = $1 AND r.company_id = $2 FOR UPDATE OF r`, [id, companyId]);
  if (!row) throw new NotFoundException("Purchase request not found");
  return row;
}

/**
 * Ownership: a distributor sees only its own requests; tele/field sales only requests they
 * created or for distributors assigned to them; managers and admins every request. Anything
 * else is reported as not found.
 */
export function assertCanSee(actor: Principal, r: Pick<RequestRow, "distributorId" | "creatorUserId" | "distributorExecutiveId">): void {
  const denied = new NotFoundException("Purchase request not found");
  if (actor.role === "distributor") {
    if (r.distributorId !== actor.distributorId) throw denied;
  } else if (ASSIGNED_ONLY_ROLES.includes(actor.role)) {
    if (r.creatorUserId !== actor.id && !(actor.employeeId && r.distributorExecutiveId === actor.employeeId)) throw denied;
  }
}

/** Who may change a draft / correction: its creator, the distributor it belongs to, or a sales manager / admin. */
export function assertCanEdit(actor: Principal, r: Pick<RequestRow, "distributorId" | "creatorUserId">): void {
  const owner = r.creatorUserId === actor.id || (actor.role === "distributor" && r.distributorId === actor.distributorId) || ["admin", "sales_manager"].includes(actor.role);
  if (!owner) throw new ForbiddenException("Only the person who created this request (or a sales manager) can change it");
}

export async function logStatus(db: Db, actor: Principal, r: Pick<RequestRow, "id" | "companyId">, from: string | null, to: string, reason?: string | null): Promise<void> {
  await db.exec(`INSERT INTO leads.purchase_status_logs (company_id, request_id, from_status, to_status, actor_id, reason) VALUES ($1, $2, $3, $4, $5, $6)`, [r.companyId, r.id, from, to, actor.id, reason ?? null]);
}

/** The full request as the API returns it (header, items, active payment, proof metadata). */
export async function loadDetail(db: Db, companyId: string, id: string) {
  const header = await db.one<any>(
    `SELECT r.id, r.request_no, r.distributor_id, d.firm_name AS distributor_name, d.distributor_code, r.source, r.creator_user_id, u.name AS creator_name, r.status, r.payment_status, r.remarks,
            r.external_invoice_ref, r.version, r.submitted_at, r.approved_by, r.approved_at, r.processed_at, r.rejection_reason, r.created_at, r.updated_at,
            d.assigned_executive_id AS distributor_executive_id
       FROM leads.purchase_requests r JOIN leads.distributors d ON d.id = r.distributor_id LEFT JOIN leads.lead_users u ON u.id = r.creator_user_id WHERE r.id = $1 AND r.company_id = $2`,
    [id, companyId],
  );
  if (!header) throw new NotFoundException("Purchase request not found");
  const items = await db.all(`SELECT id, product_id, product_snapshot, quantity, remarks FROM leads.purchase_request_items WHERE request_id = $1 ORDER BY created_at, id`, [id]);
  const payment = await db.one(
    `SELECT p.id, p.amount, p.method, p.payment_date, p.utr_raw, p.utr_normalized, p.status, p.reviewer_id, p.reviewed_at, p.rejection_reason, p.created_at,
            (SELECT json_build_object('id', f.id, 'mime', f.mime, 'sizeBytes', f.size_bytes) FROM leads.payment_proofs f WHERE f.payment_id = p.id ORDER BY f.created_at DESC LIMIT 1) AS proof
       FROM leads.purchase_payments p WHERE p.request_id = $1 AND p.is_active`,
    [id],
  );
  const submissions = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM leads.purchase_payments WHERE request_id = $1`, [id]);
  return { ...header, items, payment, paymentSubmissions: submissions?.n ?? 0 };
}

const EVENT_TEXT: Partial<Record<WhatsAppEvent, string>> = {
  request_submitted: "Purchase request submitted",
  request_received: "Purchase request received",
  payment_verified: "Payment verified",
  payment_rejected: "Payment rejected",
  correction_required: "Correction required",
  request_approved: "Purchase request approved",
  request_rejected: "Purchase request rejected",
  request_processed: "Purchase request processed",
};

/** Tells the distributor (WhatsApp + in-app) and the request's creator (in-app). Failures never undo the transition. */
export async function notifyParties(whatsapp: WhatsAppService, r: Pick<RequestRow, "id" | "companyId" | "requestNo" | "distributorMobile" | "distributorName" | "creatorUserId">, event: WhatsAppEvent, extra?: string): Promise<void> {
  const title = EVENT_TEXT[event] ?? event;
  const body = `${r.requestNo}${extra ? `: ${extra}` : ""}`;
  await whatsapp.notify({ companyId: r.companyId, event, mobile: r.distributorMobile, userId: r.creatorUserId, title, body, params: [r.distributorName, r.requestNo, ...(extra ? [extra] : [])], entity: "purchase_request", entityId: r.id });
}

