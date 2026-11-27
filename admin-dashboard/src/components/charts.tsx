import { useEffect, useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

/** Chart colours: one accent for single-series charts and meters, with a lighter step of it as the track. */
export const VIZ = { accent: "#1e40af", track: "#dbe4ff", grid: "#e9ebf0", axis: "#cfd3dc" };

/**
 * A callback ref and the content width in px of the element it is on (0 until measured).
 * Follows the element when a different one takes the ref.
 */
function useWidth(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, width];
}

// ── Ring meter ─────────────────────────────────────────────────────────────────

/** One count against its whole, as a ring: "2 of 4". */
export function RingMeter({ value, total, label, hint, to }: { value: number; total: number; label: string; hint?: string; to?: string }) {
  const share = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
  const r = 42;
  const circumference = 2 * Math.PI * r;
  const body = (
    <>
      <span className="ring-figure">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={r} fill="none" stroke={VIZ.track} strokeWidth="9" />
          {share > 0 && (
            <circle
              className="ring-fill"
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={VIZ.accent}
              strokeWidth="9"
              strokeLinecap="round"
              strokeDasharray={`${circumference * share} ${circumference}`}
              transform="rotate(-90 50 50)"
            />
          )}
        </svg>
        <span className="ring-center">
          <b>{value}</b>
          <small>of {total}</small>
        </span>
      </span>
      <span className="ring-label">{label}</span>
      {hint && <span className="ring-hint">{hint}</span>}
    </>
  );
  const name = `${label}: ${value} of ${total}${total ? ` (${Math.round(share * 100)}%)` : ""}`;
  return to ? (
    <Link to={to} className="ring clickable" aria-label={name}>
      {body}
    </Link>
  ) : (
    <div className="ring" role="img" aria-label={name}>
      {body}
    </div>
  );
}

// ── Column chart ───────────────────────────────────────────────────────────────

export interface Column {
  key: string;
  /** Short axis label, e.g. "24 Nov". */
  label: string;
  /** Full label for the tooltip and table, e.g. "Tue, 24 Nov". */
  fullLabel: string;
  value: number;
}

/** Step of 1, 2 or 5 × 10ⁿ giving about `count` ticks up to `max`. */
function niceStep(max: number, count: number, wholeNumbers: boolean): number {
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  return wholeNumbers ? Math.max(1, Math.round(step)) : step;
}

const columnPath = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
};

/**
 * One series over time as thin columns: hairline grid, rounded caps, a tooltip per column
 * (hover or keyboard focus), the highest and latest values labelled, and a table view.
 */
export function ColumnChart({
  data,
  format,
  wholeNumbers = false,
  title,
  showTable,
}: {
  data: Column[];
  format: (value: number) => string;
  wholeNumbers?: boolean;
  title: string;
  showTable: boolean;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);

  if (showTable)
    return (
      <div ref={ref} className="viz-table-wrap">
        <table className="viz-table">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className="num">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <td>{d.fullLabel}</td>
                <td className="num">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  const height = 210;
  const pad = { top: 22, right: 6, bottom: 26, left: 40 };
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const peak = Math.max(0, ...data.map((d) => d.value));
  const step = niceStep(peak || (wholeNumbers ? 4 : 1), 4, wholeNumbers);
  const top = Math.max(step, Math.ceil(peak / step) * step);
  const ticks: number[] = [];
  for (let i = 0; i * step <= top + step / 2; i += 1) ticks.push(Number((i * step).toFixed(6)));
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const labelEvery = band >= 44 ? 1 : band >= 22 ? 2 : Math.ceil(30 / Math.max(band, 1));
  const peakIndex = peak > 0 ? data.findIndex((d) => d.value === peak) : -1;
  const lastIndex = data.length - 1;
  const labelled = new Set([peakIndex, data[lastIndex]?.value > 0 ? lastIndex : -1].filter((i) => i >= 0));
  // Axis ticks are plain clean numbers (0, 10, 20); the chart title carries the unit.
  const tickText = (t: number) => String(Number(t.toFixed(2)));
  const hovered = active !== null ? data[active] : null;

  return (
    <div ref={ref} className="viz-plot" onPointerLeave={() => setActive(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${title}. Use the table view for every value.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? VIZ.axis : VIZ.grid} strokeWidth="1" shapeRendering="crispEdges" />
              <text x={pad.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="viz-tick">
                {tickText(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = pad.left + band * i + band / 2;
            const h = (d.value / top) * plotH;
            const isActive = active === i;
            return (
              <g key={d.key}>
                {h > 0 && <path d={columnPath(cx - barW / 2, y(d.value), barW, h)} fill={VIZ.accent} opacity={active === null || isActive ? 1 : 0.55} />}
                {labelled.has(i) && h > 0 && (
                  <text x={cx} y={y(d.value) - 6} textAnchor="middle" className="viz-value">
                    {format(d.value)}
                  </text>
                )}
                {(i % labelEvery === 0 || i === lastIndex) && (i === lastIndex || lastIndex - i >= labelEvery) && (
                  <text x={cx} y={height - 8} textAnchor="middle" className="viz-tick">
                    {d.label}
                  </text>
                )}
                {/* The whole column band is the hit area, not just the painted bar. */}
                <rect
                  x={pad.left + band * i}
                  y={pad.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${d.fullLabel}: ${format(d.value)}`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="viz-hit"
                />
              </g>
            );
          })}
        </svg>
      )}
      {hovered && active !== null && (
        <div
          className="viz-tooltip"
          style={{ left: Math.min(Math.max(pad.left + band * active + band / 2, 60), width - 60), top: Math.max(4, y(hovered.value) - 52) }}
          aria-hidden="true"
        >
          <b>{format(hovered.value)}</b>
          <span>{hovered.fullLabel}</span>
        </div>
      )}
    </div>
  );
}

// ── Segmented bar ──────────────────────────────────────────────────────────────

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
  /** Text colour inside the block: white, or near-black on light fills. */
  ink: string;
  to?: string;
}

/** One whole split into parts: share printed where it fits, names and counts in the legend below. */
export function SegmentedBar({ parts, emptyText }: { parts: Segment[]; emptyText: ReactNode }) {
  const [ref, width] = useWidth();
  const tipId = useId();
  const [active, setActive] = useState<string | null>(null);
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  const pct = (v: number) => `${Math.round((v / (total || 1)) * 100)}%`;
  const current = shown.find((p) => p.key === active);
  const [tipX, setTipX] = useState(0);
  const show = (key: string, block: HTMLElement) => {
    setActive(key);
    setTipX(block.offsetLeft + block.offsetWidth / 2);
  };

  return (
    <div className="seg">
      <div ref={ref} className="seg-bar" onPointerLeave={() => setActive(null)}>
        {!total ? (
          <div className="seg-empty">{emptyText}</div>
        ) : (
          shown.map((p) => {
            const blockWidth = (p.value / total) * Math.max(0, width - 2 * (shown.length - 1));
            return (
              <div
                key={p.key}
                className={`seg-block${active && active !== p.key ? " dim" : ""}`}
                // Basis 0, so widths follow the values alone, not the text inside.
                style={{ flex: `${p.value} 1 0`, background: p.color, color: p.ink }}
                tabIndex={0}
                aria-label={`${p.label}: ${p.value} (${pct(p.value)})`}
                aria-describedby={active === p.key ? tipId : undefined}
                onPointerEnter={(e) => show(p.key, e.currentTarget)}
                onFocus={(e) => show(p.key, e.currentTarget)}
                onBlur={() => setActive(null)}
              >
                {blockWidth >= 40 && pct(p.value)}
              </div>
            );
          })
        )}
        {current && (
          <div id={tipId} role="tooltip" className="viz-tooltip seg-tip" style={{ left: Math.min(Math.max(tipX, 60), Math.max(60, width - 60)) }}>
            <b>{current.value}</b>
            <span>
              {current.label} · {pct(current.value)}
            </span>
          </div>
        )}
      </div>
      <ul className="seg-legend">
        {parts.map((p) => {
          const body = (
            <>
              <i style={{ background: p.color }} />
              <span>{p.label}</span>
              <b>{p.value}</b>
            </>
          );
          return <li key={p.key}>{p.to ? <Link to={p.to}>{body}</Link> : body}</li>;
        })}
      </ul>
    </div>
  );
}
