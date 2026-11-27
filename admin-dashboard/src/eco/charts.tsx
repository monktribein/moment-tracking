import { useState, type ReactNode } from "react";
import { words } from "./format";

export const ECO_COLORS = { blue: "#1e40af", blueBright: "#2563eb", orange: "#f97316", green: "#22c55e", amber: "#f59e0b", red: "#ef4444", violet: "#8b5cf6", gray: "#cbd5e1", teal: "#14b8a6" };

const monthShort = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return { m: new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short" }), y: String(y) };
};

const niceMax = (v: number) => {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= v) ?? 10 * p;
};

/**
 * Monthly trend like the Eco Sor mock-ups: blue bars for one series, an orange line with dots for
 * the other. Data is `[{ month: "2026-11", ... }]`; empty months show as zero.
 */
export function TrendChart({ data, bar, line, height = 230 }: { data: Record<string, unknown>[]; bar: { key: string; label: string }; line?: { key: string; label: string }; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = data.map((d) => [Number(d[bar.key]) || 0, line ? Number(d[line.key]) || 0 : 0]);
  const max = niceMax(Math.max(1, ...values.flat()));
  const W = 560;
  const H = height;
  const left = 36;
  const bottom = 40;
  const top = 12;
  const plotW = W - left - 8;
  const plotH = H - top - bottom;
  const step = plotW / Math.max(1, data.length);
  const bw = Math.min(46, step * 0.5);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t * 10) / 10);
  const points = values.map(([, l], i) => `${left + step * i + step / 2},${y(l)}`).join(" ");

  return (
    <div className="eco-chart">
      <div className="eco-legend">
        <span><i style={{ background: ECO_COLORS.blueBright }} /> {bar.label}</span>
        {line && <span><i className="dot" style={{ background: ECO_COLORS.orange }} /> {line.label}</span>}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${bar.label}${line ? ` and ${line.label}` : ""} by month`} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - 8} y1={y(t)} y2={y(t)} stroke="#e8ecf4" />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" className="eco-axis">{t}</text>
          </g>
        ))}
        {values.map(([b], i) => {
          const x = left + step * i + (step - bw) / 2;
          return (
            <g key={i} onPointerEnter={() => setHover(i)}>
              <rect x={left + step * i} y={top} width={step} height={plotH} fill="transparent" />
              <rect x={x} y={y(b)} width={bw} height={Math.max(0, top + plotH - y(b))} rx={5} fill={hover === i ? ECO_COLORS.blue : ECO_COLORS.blueBright} />
            </g>
          );
        })}
        {line && <polyline points={points} fill="none" stroke={ECO_COLORS.orange} strokeWidth={2.5} strokeLinejoin="round" />}
        {line && values.map(([, l], i) => <circle key={i} cx={left + step * i + step / 2} cy={y(l)} r={4.5} fill={ECO_COLORS.orange} stroke="#fff" strokeWidth={1.5} />)}
        {data.map((d, i) => {
          const { m, y: yr } = monthShort(String(d.month));
          return (
            <text key={i} x={left + step * i + step / 2} y={H - 22} textAnchor="middle" className="eco-axis">
              <tspan x={left + step * i + step / 2}>{m}</tspan>
              <tspan x={left + step * i + step / 2} dy={13}>{yr}</tspan>
            </text>
          );
        })}
        {hover !== null && (
          <g transform={`translate(${Math.min(W - 150, left + step * hover + step / 2 - 70)}, ${top})`}>
            <rect width={140} height={line ? 44 : 28} rx={6} fill="#0b1f4d" opacity={0.92} />
            <text x={8} y={18} className="eco-tip">{bar.label}: {values[hover][0]}</text>
            {line && <text x={8} y={36} className="eco-tip">{line.label}: {values[hover][1]}</text>}
          </g>
        )}
      </svg>
    </div>
  );
}

export interface DonutPart {
  key: string;
  label?: string;
  value: number;
  color: string;
}

/** A donut with the total (or a headline) in the middle and a legend with counts and shares. */
export function Donut({ parts, center, centerLabel, empty = "No data yet." }: { parts: DonutPart[]; center?: ReactNode; centerLabel?: string; empty?: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  if (!total) return <p className="muted">{empty}</p>;
  return (
    <div className="eco-donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={parts.map((p) => `${p.label ?? words(p.key)} ${p.value}`).join(", ")}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="#eef2f7" strokeWidth="20" />
        {parts.filter((p) => p.value > 0).map((p) => {
          const len = (p.value / total) * c;
          const el = <circle key={p.key} cx="70" cy="70" r={r} fill="none" stroke={p.color} strokeWidth="20" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />;
          offset += len;
          return el;
        })}
        <text x="70" y="68" textAnchor="middle" className="eco-donut-value">{center ?? total}</text>
        <text x="70" y="86" textAnchor="middle" className="eco-donut-label">{centerLabel ?? "Total"}</text>
      </svg>
      <ul className="eco-donut-legend">
        {parts.map((p) => (
          <li key={p.key}>
            <i style={{ background: p.color }} />
            <span>{p.label ?? words(p.key)} ({p.value})</span>
            <b>{Math.round((p.value / total) * 100)}%</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Vertical bars per category (e.g. complaints by category), each in its own colour. */
export function CategoryBars({ items, height = 170 }: { items: { key: string; label?: string; value: number }[]; height?: number }) {
  const palette = [ECO_COLORS.blueBright, ECO_COLORS.orange, ECO_COLORS.green, ECO_COLORS.violet, ECO_COLORS.teal, ECO_COLORS.amber, ECO_COLORS.red];
  if (!items.length) return <p className="muted">No data yet.</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="eco-catbars" style={{ height }}>
      {items.map((it, i) => (
        <div key={it.key} className="eco-catbar" title={`${it.label ?? words(it.key)}: ${it.value}`}>
          <b>{it.value}</b>
          <span style={{ height: `${(it.value / max) * 100}%`, background: palette[i % palette.length] }} />
          <small>{it.label ?? words(it.key)}</small>
        </div>
      ))}
    </div>
  );
}

/** Change between the last two points of a series, in percent (null when not computable). */
export function changePct(series: Record<string, unknown>[] | undefined, key: string): number | null {
  if (!series || series.length < 2) return null;
  const now = Number(series[series.length - 1][key]) || 0;
  const before = Number(series[series.length - 2][key]) || 0;
  if (!before) return null;
  return Math.round(((now - before) / before) * 100);
}
