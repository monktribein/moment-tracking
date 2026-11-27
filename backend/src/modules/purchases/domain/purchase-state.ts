/**
 * Purchase request state machine (SRS section 7).
 *
 *   draft -> submitted -> under_review -> approved -> processed
 *   under_review -> correction_required -> (resubmit) -> under_review
 *   rejected and cancelled are final.
 *
 * Payment verification is a separate step: verifying a payment moves a submitted
 * request to under_review; rejecting it sends the request to correction_required.
 * Approval needs a verified payment.
 */
export const PURCHASE_STATUSES = ["draft", "submitted", "under_review", "correction_required", "approved", "rejected", "cancelled", "processed"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export type PurchaseAction = "submit" | "verify_payment" | "reject_payment" | "resubmit" | "approve" | "reject" | "cancel" | "process";

export const ACTION_TRANSITIONS: Record<PurchaseAction, { from: PurchaseStatus[]; to: PurchaseStatus }> = {
  submit: { from: ["draft"], to: "submitted" },
  verify_payment: { from: ["submitted", "under_review"], to: "under_review" },
  reject_payment: { from: ["submitted", "under_review"], to: "correction_required" },
  resubmit: { from: ["correction_required"], to: "under_review" },
  approve: { from: ["under_review"], to: "approved" },
  reject: { from: ["submitted", "under_review", "correction_required"], to: "rejected" },
  cancel: { from: ["draft", "submitted", "under_review", "correction_required"], to: "cancelled" },
  process: { from: ["approved"], to: "processed" },
};

export const FINAL_STATUSES: PurchaseStatus[] = ["rejected", "cancelled", "processed"];

/** The next status for an action, or null when the request is in the wrong state. */
export function nextStatus(from: string, action: PurchaseAction): PurchaseStatus | null {
  const rule = ACTION_TRANSITIONS[action];
  return rule.from.includes(from as PurchaseStatus) ? rule.to : null;
}

/** Items, remarks and payment can change only before review starts, or while a correction is requested. Approved/processed records are frozen. */
export const isEditable = (status: string): boolean => status === "draft" || status === "correction_required";

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  correction_required: "Correction required",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  processed: "Processed",
};

/** Normalizes a bank transaction reference: upper-case letters and digits only ("utr 12-34 ab" -> "UTR1234AB"). */
export const normalizeUtr = (raw: string): string => String(raw ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/** A usable reference has at least 6 characters once normalized (UPI/NEFT/IMPS references are 12+; cheques are shorter). */
export const isPlausibleUtr = (raw: string): boolean => {
  const n = normalizeUtr(raw);
  return n.length >= 6 && n.length <= 40;
};

export interface ItemInput {
  productId: string;
  quantity: number;
  remarks?: string;
}

/** Returns the first problem with an item list, or null. Quantities must be positive whole numbers; a product may appear once. */
export function itemsProblem(items: ItemInput[] | undefined): string | null {
  if (!items?.length) return "Add at least one item";
  const seen = new Set<string>();
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) return "Quantity must be a positive whole number";
    if (seen.has(item.productId)) return "A product can appear only once. Increase its quantity instead.";
    seen.add(item.productId);
  }
  return null;
}
