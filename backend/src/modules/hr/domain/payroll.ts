/**
 * Payroll rules. Formula: fixed salary / calculation days x payable days + authorised adjustments.
 * The day-count rules are settings (system_settings, keys "payroll.*"), not code.
 */
export interface PayrollSettings {
  /** calendar: every day of the month; fixed: payroll.calc_days_fixed (e.g. 30); working: excludes weekly offs and holidays. */
  calcDaysMode: "calendar" | "fixed" | "working";
  calcDaysFixed: number;
  halfDayEnabled: boolean;
  /** A checked-out day shorter than this many minutes counts as half a day. */
  halfDayMinutes: number;
  /** A working day with no attendance and no approved leave is unpaid. */
  absentUnpaid: boolean;
  /** Leave types that do not reduce pay. Others (e.g. unpaid) do. */
  paidLeaveTypes: string[];
}

export const PAYROLL_DEFAULTS: PayrollSettings = {
  calcDaysMode: "calendar",
  calcDaysFixed: 30,
  halfDayEnabled: true,
  halfDayMinutes: 240,
  absentUnpaid: true,
  paidLeaveTypes: ["casual", "sick", "earned"],
};

export const PAYROLL_SETTING_KEYS: Record<string, keyof PayrollSettings> = {
  "payroll.calc_days_mode": "calcDaysMode",
  "payroll.calc_days_fixed": "calcDaysFixed",
  "payroll.half_day_enabled": "halfDayEnabled",
  "payroll.half_day_minutes": "halfDayMinutes",
  "payroll.absent_unpaid": "absentUnpaid",
  "payroll.paid_leave_types": "paidLeaveTypes",
};

export function mergeSettings(rows: { key: string; value: unknown }[]): PayrollSettings {
  const out: Record<string, unknown> = { ...PAYROLL_DEFAULTS };
  for (const row of rows) {
    const field = PAYROLL_SETTING_KEYS[row.key];
    if (field && row.value !== null && row.value !== undefined) out[field] = row.value;
  }
  const s = out as unknown as PayrollSettings;
  if (!["calendar", "fixed", "working"].includes(s.calcDaysMode)) s.calcDaysMode = "calendar";
  return s;
}

export interface DayFacts {
  date: string;
  weekday: string;
  /** Present when the person has attendance that day. */
  attended: boolean;
  workedMinutes: number | null;
  checkedOut: boolean;
  holiday: boolean;
  /** Type of an approved leave covering the day, if any. */
  leaveType: string | null;
}

export interface PayrollInput {
  fixedSalary: number;
  weeklyOff: string[];
  days: DayFacts[];
  /** Days after this date are not judged yet (the month is still running). */
  asOf: string;
  adjustments: number;
  settings: PayrollSettings;
}

export interface PayrollResult {
  calcDays: number;
  payableDays: number;
  unpaidDays: number;
  netPayable: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function computePayroll(input: PayrollInput): PayrollResult {
  const { settings: s } = input;
  let unpaid = 0;
  let workingDays = 0;
  for (const d of input.days) {
    const off = input.weeklyOff.includes(d.weekday);
    if (!off && !d.holiday) workingDays++;
    if (off || d.holiday || d.date > input.asOf) continue; // paid, or not judged yet
    if (d.leaveType) {
      if (!s.paidLeaveTypes.includes(d.leaveType)) unpaid += 1;
      continue;
    }
    if (d.attended) {
      if (s.halfDayEnabled && d.checkedOut && d.workedMinutes !== null && d.workedMinutes < s.halfDayMinutes) unpaid += 0.5;
      continue;
    }
    if (s.absentUnpaid) unpaid += 1;
  }
  const calcDays = s.calcDaysMode === "fixed" ? s.calcDaysFixed : s.calcDaysMode === "working" ? workingDays : input.days.length;
  const unpaidDays = Math.min(unpaid, calcDays);
  const payableDays = Math.max(0, calcDays - unpaidDays);
  const perDay = calcDays > 0 ? input.fixedSalary / calcDays : 0;
  return { calcDays, payableDays, unpaidDays, netPayable: round2(perDay * payableDays + input.adjustments) };
}

/** Every date of a YYYY-MM month with its weekday name. */
export function monthDays(month: string): { date: string; weekday: string }[] {
  const [y, m] = month.split("-").map(Number);
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    return { date, weekday: names[new Date(`${date}T00:00:00Z`).getUTCDay()] };
  });
}
