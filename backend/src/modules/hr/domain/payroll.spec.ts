import { computePayroll, type DayFacts, mergeSettings, monthDays, PAYROLL_DEFAULTS } from "./payroll";

const settings = PAYROLL_DEFAULTS;

/** A month where every non-off, non-holiday day is attended unless overridden. */
function days(month: string, override: (d: DayFacts) => Partial<DayFacts> = () => ({})): DayFacts[] {
  return monthDays(month).map(({ date, weekday }) => {
    const base: DayFacts = { date, weekday, attended: weekday !== "sunday", workedMinutes: 480, checkedOut: true, holiday: false, leaveType: null };
    return { ...base, ...override(base) };
  });
}

describe("payroll calculation", () => {
  it("pays the full salary for a full month", () => {
    const r = computePayroll({ fixedSalary: 30000, weeklyOff: ["sunday"], days: days("2026-09"), asOf: "2026-09-30", adjustments: 0, settings });
    expect(r).toEqual({ calcDays: 30, payableDays: 30, unpaidDays: 0, netPayable: 30000 });
  });

  it("deducts absent days: fixed salary / calc days x payable days", () => {
    const r = computePayroll({ fixedSalary: 30000, weeklyOff: ["sunday"], days: days("2026-09", (d) => (d.date === "2026-09-02" || d.date === "2026-09-03" ? { attended: false } : {})), asOf: "2026-09-30", adjustments: 0, settings });
    expect(r.unpaidDays).toBe(2);
    expect(r.payableDays).toBe(28);
    expect(r.netPayable).toBe(28000);
  });

  it("counts a short checked-out day as half a day, and can be switched off", () => {
    const short = days("2026-09", (d) => (d.date === "2026-09-02" ? { workedMinutes: 120 } : {}));
    expect(computePayroll({ fixedSalary: 30000, weeklyOff: ["sunday"], days: short, asOf: "2026-09-30", adjustments: 0, settings }).unpaidDays).toBe(0.5);
    expect(computePayroll({ fixedSalary: 30000, weeklyOff: ["sunday"], days: short, asOf: "2026-09-30", adjustments: 0, settings: { ...settings, halfDayEnabled: false } }).unpaidDays).toBe(0);
  });

  it("pays holidays, weekly offs and paid leave but not unpaid leave", () => {
    const d = days("2026-09", (x) => {
      if (x.date === "2026-09-02") return { attended: false, holiday: true };
      if (x.date === "2026-09-03") return { attended: false, leaveType: "casual" };
      if (x.date === "2026-09-04") return { attended: false, leaveType: "unpaid" };
      return {};
    });
    const r = computePayroll({ fixedSalary: 30000, weeklyOff: ["sunday"], days: d, asOf: "2026-09-30", adjustments: 0, settings });
    expect(r.unpaidDays).toBe(1);
  });

  it("adds authorised adjustments to the net pay", () => {
    const r = computePayroll({ fixedSalary: 30000, weeklyOff: ["sunday"], days: days("2026-09"), asOf: "2026-09-30", adjustments: -500.5, settings });
    expect(r.netPayable).toBe(29499.5);
  });

  it("uses the configured calculation days", () => {
    const fixed = computePayroll({ fixedSalary: 30000, weeklyOff: ["sunday"], days: days("2026-10"), asOf: "2026-10-31", adjustments: 0, settings: { ...settings, calcDaysMode: "fixed", calcDaysFixed: 30 } });
    expect(fixed.calcDays).toBe(30);
    expect(fixed.netPayable).toBe(30000);
    const working = computePayroll({ fixedSalary: 26000, weeklyOff: ["sunday"], days: days("2026-10"), asOf: "2026-10-31", adjustments: 0, settings: { ...settings, calcDaysMode: "working" } });
    expect(working.calcDays).toBe(27); // October 2026 has 31 days and 4 Sundays
    expect(working.netPayable).toBe(26000);
  });

  it("does not judge days that have not happened yet", () => {
    const d = days("2026-09", (x) => (x.date > "2026-09-10" ? { attended: false } : {}));
    const r = computePayroll({ fixedSalary: 30000, weeklyOff: ["sunday"], days: d, asOf: "2026-09-10", adjustments: 0, settings });
    expect(r.unpaidDays).toBe(0);
  });

  it("never pays more than the salary or a negative day count", () => {
    const d = days("2026-02", () => ({ attended: false }));
    const r = computePayroll({ fixedSalary: 28000, weeklyOff: [], days: d, asOf: "2026-02-28", adjustments: 0, settings });
    expect(r.payableDays).toBe(0);
    expect(r.netPayable).toBe(0);
  });
});

describe("payroll settings", () => {
  it("falls back to defaults and ignores bad modes", () => {
    expect(mergeSettings([])).toEqual(PAYROLL_DEFAULTS);
    expect(mergeSettings([{ key: "payroll.calc_days_mode", value: "nonsense" }]).calcDaysMode).toBe("calendar");
    expect(mergeSettings([{ key: "payroll.half_day_minutes", value: 300 }]).halfDayMinutes).toBe(300);
  });

  it("lists the days of a month with weekday names", () => {
    const d = monthDays("2026-02");
    expect(d).toHaveLength(28);
    expect(d[0]).toEqual({ date: "2026-02-01", weekday: "sunday" });
  });
});
