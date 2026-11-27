/** Sales visit flow: scheduled -> checked_in -> report_submitted -> completed; scheduled visits can be cancelled or rescheduled. */
export type VisitStatus = "scheduled" | "checked_in" | "report_submitted" | "completed" | "cancelled" | "rescheduled";

export const VISIT_TRANSITIONS: Record<VisitStatus, VisitStatus[]> = {
  scheduled: ["checked_in", "cancelled", "rescheduled"],
  checked_in: ["report_submitted"],
  report_submitted: ["completed"],
  completed: [],
  cancelled: [],
  rescheduled: [],
};

export const canVisitMove = (from: string, to: VisitStatus): boolean => (VISIT_TRANSITIONS[from as VisitStatus] ?? []).includes(to);

export interface GpsFix {
  lat: number;
  lng: number;
  accuracy: number;
  at: Date;
}

/** A check-in position: finite, in range, not the (0,0) "no fix" default. */
export function readFix(input: { lat: number; lng: number; accuracy?: number; timestamp?: string }, now = new Date()): GpsFix | null {
  const { lat, lng } = input;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  const accuracy = Number.isFinite(input.accuracy) && (input.accuracy as number) >= 0 ? (input.accuracy as number) : 0;
  // The device clock is only trusted within 10 minutes of the server's.
  const claimed = input.timestamp ? new Date(input.timestamp) : null;
  const at = claimed && !Number.isNaN(claimed.getTime()) && Math.abs(claimed.getTime() - now.getTime()) <= 10 * 60_000 ? claimed : now;
  return { lat, lng, accuracy, at };
}
