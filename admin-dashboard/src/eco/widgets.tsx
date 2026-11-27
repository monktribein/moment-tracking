import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../components/ui";
import { words } from "./format";

export type KpiTone = "blue" | "violet" | "green" | "orange" | "red" | "teal" | "amber";

/**
 * KPI card like the Eco Sor mock-ups: a coloured icon circle, the value, the label, and the change
 * against last month when the API gives a series for it (never invented).
 */
export function Kpi({
  label,
  value,
  hint,
  to,
  accent,
  icon,
  tone = accent ? "orange" : "blue",
  delta,
  goodWhenDown,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  to?: string;
  accent?: boolean;
  icon?: ReactNode;
  tone?: KpiTone;
  delta?: number | null;
  goodWhenDown?: boolean;
}) {
  const navigate = useNavigate();
  const up = (delta ?? 0) >= 0;
  const good = goodWhenDown ? !up : up;
  const body = (
    <>
      {icon && <span className={`kpi-icon kpi-${tone}`}>{icon}</span>}
      <span className="kpi-main">
        <span className="kpi-top">
          <span className="kpi-value">{value ?? 0}</span>
          {delta !== null && delta !== undefined && (
            <span className={`kpi-delta ${good ? "good" : "bad"}`} title="Change against last month">
              {up ? "↑" : "↓"} {Math.abs(delta)}%
            </span>
          )}
        </span>
        <span className="kpi-label">{label}</span>
        {hint && <span className="kpi-hint">{hint}</span>}
      </span>
    </>
  );
  const cls = `kpi kpi-card-${tone}${icon ? " with-icon" : ""}${to ? " clickable" : ""}`;
  return to ? (
    <button type="button" className={cls} onClick={() => navigate(to)}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A coloured quick-action tile (icon above the label). */
export function QuickTile({ icon, label, tone = "blue", onClick }: { icon: ReactNode; label: string; tone?: KpiTone; onClick: () => void }) {
  return (
    <button type="button" className={`quick-tile kpi-card-${tone}`} onClick={onClick}>
      <span className={`quick-icon kpi-${tone}`}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/** A dashboard panel: title with an optional icon and "View all" link. */
export function Panel({ title, icon, action, children, className = "" }: { title: string; icon?: ReactNode; action?: { label: string; to: string }; children: ReactNode; className?: string }) {
  const navigate = useNavigate();
  return (
    <section className={`card eco-panel ${className}`}>
      <div className="eco-panel-head">
        <h2>
          {icon && <span className="eco-panel-icon">{icon}</span>}
          {title}
        </h2>
        {action && (
          <button type="button" className="link-button" onClick={() => navigate(action.to)}>
            {action.label} →
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/** Counts by status as horizontal bars (largest first), with the order given by `order` when known. */
export function StatusBars({ counts, order, empty = "No data yet." }: { counts: Record<string, number> | undefined; order?: string[]; empty?: string }) {
  const entries = useMemo(() => {
    const all = Object.entries(counts ?? {});
    if (order) all.sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99));
    else all.sort((a, b) => b[1] - a[1]);
    return all;
  }, [counts, order]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  if (!entries.length) return <p className="muted">{empty}</p>;
  return (
    <div className="hbars" role="list">
      {entries.map(([key, n]) => (
        <div className="hbar" role="listitem" key={key} aria-label={`${words(key)}: ${n}`}>
          <span>{words(key)}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${(n / max) * 100}%`, display: "block" }} />
          </span>
          <b>{n}</b>
        </div>
      ))}
    </div>
  );
}

export const sumOf = (counts: Record<string, number> | undefined, keys?: string[]): number =>
  Object.entries(counts ?? {}).reduce((s, [k, n]) => (keys && !keys.includes(k) ? s : s + n), 0);

export interface CalEvent {
  date: string;
  label: string;
  kind?: "holiday" | "event";
  onClick?: () => void;
}

/** A month grid (Monday first) with events per day. `month` is YYYY-MM. */
export function MonthCalendar({ month, onMonth, events }: { month: string; onMonth: (m: string) => void; events: CalEvent[] }) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  const cells: { date: string; day: number; other: boolean }[] = [];
  for (let i = -startOffset; i < Math.ceil((startOffset + days) / 7) * 7 - startOffset; i++) {
    const d = new Date(y, m - 1, 1 + i);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    cells.push({ date, day: d.getDate(), other: d.getMonth() !== m - 1 });
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1);
    onMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  return (
    <div>
      <div className="toolbar">
        <strong>{first.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</strong>
        <div className="button-row">
          <Button size="sm" icon={<ChevronLeft size={16} />} onClick={() => shift(-1)} aria-label="Previous month" />
          <Button size="sm" onClick={() => onMonth(today.slice(0, 7))}>
            This month
          </Button>
          <Button size="sm" icon={<ChevronRight size={16} />} onClick={() => shift(1)} aria-label="Next month" />
        </div>
      </div>
      <div className="cal">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div className="cal-head" key={d}>
            {d}
          </div>
        ))}
        {cells.map((c) => (
          <div key={c.date} className={`cal-day${c.other ? " other" : ""}${c.date === today ? " today" : ""}`}>
            <div className="cal-date">{c.day}</div>
            {(byDay.get(c.date) ?? []).slice(0, 4).map((e, i) => (
              <button type="button" key={i} className={`cal-event${e.kind === "holiday" ? " holiday" : ""}`} title={e.label} onClick={e.onClick}>
                {e.label}
              </button>
            ))}
            {(byDay.get(c.date)?.length ?? 0) > 4 && <span className="cell-sub">+{(byDay.get(c.date)?.length ?? 0) - 4} more</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
