import type { LeadStatus, StaffRole } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

export const dateString = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayString = (): string => dateString(new Date());

export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dateString(d);
}

const valid = (v: unknown): Date | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const fmtTime = (v: unknown): string => {
  const d = valid(v);
  return d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
};

export const fmtDateTime = (v: unknown): string => {
  const d = valid(v);
  if (!d) return "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString([], {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
};

/** A date (Date, ISO string or YYYY-MM-DD day) as "Mon, 23 Nov". */
export const fmtDate = (v: unknown): string => {
  if (!v) return "—";
  const d = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : valid(v);
  if (!d || Number.isNaN(d.getTime())) return String(v);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
};

export const fmtKm = (km: unknown): string => {
  const n = Number(km) || 0;
  return `${n < 10 ? n.toFixed(2) : n.toFixed(1)} km`;
};

export const fmtDuration = (minutes: unknown): string => {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
};

export const fmtAgo = (minutes: number | null | undefined): string => {
  if (minutes === null || minutes === undefined) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
};

export const fmtMoney = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : `₹${Number(v).toLocaleString("en-IN")}`;

export const ROLE_LABELS: Record<StaffRole, string> = {
  field_agent: "Field agent",
  lead_executive: "Lead executive",
  field_supervisor: "Supervisor",
  document_verifier: "Document verifier",
};
export const roleLabel = (role: string): string => ROLE_LABELS[role as StaffRole] ?? role;

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  converted: "Converted",
};

export const ATTENDANCE_LABELS: Record<string, string> = {
  present: "Present",
  half_day: "Half day",
  checked_in: "Checked in",
  checked_out: "Checked out",
  absent: "Absent",
};

export const place = (a: { district?: string; state?: string } | null | undefined): string =>
  [a?.district, a?.state].filter(Boolean).join(", ");

export const mapsUrl = (lat: unknown, lng: unknown): string => `https://www.google.com/maps?q=${Number(lat)},${Number(lng)}`;
export const coordsText = (lat: unknown, lng: unknown): string => `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;

/** A real GPS point (not missing, not 0,0). */
export const hasFix = <T extends { lat?: unknown; lng?: unknown }>(c: T | null | undefined): c is T & { lat: number; lng: number } => {
  if (!c) return false;
  const lat = c.lat === null || c.lat === "" ? NaN : Number(c.lat);
  const lng = c.lng === null || c.lng === "" ? NaN : Number(c.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
};

/** A strong random password for a new account (no look-alike characters). */
export function generatePassword(length = 12): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "@#$%&*"];
  const all = sets.join("");
  const pick = (chars: string) => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length];
  const out = sets.map(pick);
  while (out.length < length) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join("");
}

/** Stop labels in order: A … Z, then AA, AB, … */
export function stopLetter(index: number): string {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  return label;
}

/** Whole days from `from` to `to` (YYYY-MM-DD), counting both. */
export const daySpan = (from: string, to: string): number =>
  Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000) + 1;
