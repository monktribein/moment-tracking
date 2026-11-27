import type { Tone } from "../components/ui";

/** Indian formats: dates like "27 Nov 2026", money like ₹1,25,000.50. */
export const inr = (v: unknown): string => {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
};

const toDate = (v: unknown): Date | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const inDate = (v: unknown): string => toDate(v)?.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) ?? "—";

export const inDateTime = (v: unknown): string =>
  toDate(v)?.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }) ?? "—";

export const monthLabel = (month: string): string => {
  const d = toDate(`${month}-01`);
  return d ? d.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) : month;
};

export const words = (s: unknown): string => String(s ?? "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Today in India (YYYY-MM-DD), the same day the server uses. */
export const todayIn = (): string => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const TONES: Record<string, Tone> = {
  draft: "gray",
  submitted: "blue",
  new: "blue",
  under_review: "amber",
  correction_required: "red",
  approved: "green",
  rejected: "red",
  cancelled: "gray",
  processed: "violet",
  pending: "amber",
  verified: "green",
  scheduled: "blue",
  checked_in: "amber",
  report_submitted: "indigo",
  completed: "green",
  rescheduled: "gray",
  done: "green",
  open: "blue",
  assigned: "blue",
  in_progress: "amber",
  resolved: "green",
  closed: "gray",
  reopened: "red",
  reimbursed: "violet",
  finalized: "violet",
  eligible: "green",
  not_eligible: "red",
  active: "green",
  inactive: "gray",
  checked_out: "green",
  present: "green",
  half_day: "amber",
  absent: "red",
};

export const toneOf = (status: unknown): Tone => TONES[String(status)] ?? "gray";

/** A random UUID for Idempotency-Key headers. */
export const uuid = (): string =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16));
