/**
 * Complaint flow (SRS section 10): open -> assigned -> in_progress -> resolved -> closed.
 * `pending` (further action needed) and `reopened` are also supported. Closing needs a verified customer OTP.
 */
export const COMPLAINT_STATUSES = ["open", "assigned", "in_progress", "pending", "resolved", "closed", "reopened"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export type ComplaintAction = "assign" | "reassign" | "check_in" | "report_resolved" | "report_pending" | "close" | "reopen";

export const COMPLAINT_TRANSITIONS: Record<ComplaintAction, { from: ComplaintStatus[]; to: ComplaintStatus }> = {
  assign: { from: ["open", "reopened"], to: "assigned" },
  reassign: { from: ["assigned", "in_progress", "pending"], to: "assigned" },
  check_in: { from: ["assigned", "pending"], to: "in_progress" },
  report_resolved: { from: ["in_progress"], to: "resolved" },
  report_pending: { from: ["in_progress"], to: "pending" },
  close: { from: ["resolved"], to: "closed" },
  reopen: { from: ["resolved", "closed"], to: "reopened" },
};

export function nextComplaintStatus(from: string, action: ComplaintAction): ComplaintStatus | null {
  const rule = COMPLAINT_TRANSITIONS[action];
  return rule.from.includes(from as ComplaintStatus) ? rule.to : null;
}

/** Issue categories (SRS section 10). No installation complaints. */
export const COMPLAINT_CATEGORIES = [
  "inverter_not_working",
  "inverter_error_code",
  "inverter_power_or_charging",
  "battery_not_charging",
  "battery_low_backup",
  "battery_discharge_or_not_working",
  "other_inverter_battery",
] as const;
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];

/** A category must fit the product it is raised for ("other" fits both). */
export function categoryFitsProduct(category: string, productCategory: string): boolean {
  if (category === "other_inverter_battery") return true;
  return category.startsWith(productCategory === "inverter" ? "inverter_" : "battery_");
}
