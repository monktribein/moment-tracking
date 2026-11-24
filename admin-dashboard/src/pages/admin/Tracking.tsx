import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import L from "leaflet";
import { ArrowLeft, ChevronLeft, ChevronRight, Crosshair, RefreshCw, Search, X } from "lucide-react";
import { adminApi } from "../../api";
import { RoleBadge } from "../../components/badges";
import { escapeHtml, INDIA, useLeafletMap } from "../../components/useLeafletMap";
import { Badge, Button, Empty, ErrorBox, Spinner } from "../../components/ui";
import {
  addDays,
  ATTENDANCE_LABELS,
  coordsText,
  fmtAgo,
  fmtDate,
  fmtDuration,
  fmtKm,
  fmtTime,
  hasFix,
  mapsUrl,
  place,
  todayString,
} from "../../format";
import { useAsync, useInterval } from "../../hooks";
import type { AttendanceLog, LiveFix, ShiftRoute, Staff, TimelineLeg, TrackingConsent, TrackingDay } from "../../types";

const LIVE_MINUTES = 15;
const RECENT_MINUTES = 120;
// Check-ins the server placed at the district centre on sign-in: not a real GPS fix.
const LOGIN_CHECK_IN_NOTES = ["Shift login check-in", "Initial shift login attendance"];
const COLORS = { live: "#16a34a", recent: "#d97706", stale: "#94a3b8", nogps: "#2563eb", off: "#94a3b8", route: "#4338ca", stop: "#7c3aed" };
const TRACKED_ROLES = ["field_agent", "field_supervisor"];

type Filter = "all" | "duty" | "live" | "attention";
type Tab = "route" | "shifts" | "days";
type Tone = "live" | "recent" | "stale" | "nogps" | "off";

interface Row {
  id: string;
  agent: Staff;
  fix: LiveFix | null;
  today: AttendanceLog | null;
  onDuty: boolean;
  checkedOut: boolean;
  tone: Tone;
  live: boolean;
  attention: boolean;
  checkInPoint: { lat: number; lng: number } | null;
  duty: string;
}

function describe(agent: Staff, fix: LiveFix | null, today: AttendanceLog | null): Row {
  const onDuty = Boolean(today?.checkedIn && !today?.checkedOut);
  const checkedOut = Boolean(today?.checkedOut);
  const minutes = fix?.minutesAgo ?? null;
  const tone: Tone = fix
    ? minutes! <= LIVE_MINUTES
      ? "live"
      : minutes! <= RECENT_MINUTES
        ? "recent"
        : "stale"
    : onDuty
      ? "nogps"
      : "off";
  const live = tone === "live";
  let duty = "Not checked in today";
  if (onDuty) duty = `On duty since ${fmtTime(today?.checkInTime)}${live ? "" : fix ? " · GPS not updating" : " · no GPS"}`;
  else if (checkedOut) duty = `Checked out at ${fmtTime(today?.checkOutTime)}`;
  const realCheckIn = onDuty && hasFix(today?.checkInCoords) && !LOGIN_CHECK_IN_NOTES.includes(String(today?.notes ?? ""));
  return {
    id: agent._id,
    agent,
    fix,
    today,
    onDuty,
    checkedOut,
    tone,
    live,
    attention: onDuty && !live,
    checkInPoint: realCheckIn ? { lat: Number(today!.checkInCoords!.lat), lng: Number(today!.checkInCoords!.lng) } : null,
    duty,
  };
}

/** Map padding that keeps clear of the detail panel, which covers the map's right side on wide screens. */
function fitPadding(base: number, panelOpen: boolean): L.FitBoundsOptions {
  const covered = panelOpen && window.matchMedia("(min-width: 961px)").matches;
  return { paddingTopLeft: [base, base], paddingBottomRight: [base + (covered ? 412 : 0), base] };
}

const rank = (r: Row) => (r.live ? 0 : r.attention ? 1 : r.fix ? 2 : r.checkedOut ? 3 : 4);

/** Back-to-back moves (often one per minute) joined into trips. */
function mergeLegs(timeline: TimelineLeg[] = []) {
  const legs: (TimelineLeg & { km: number; minutes: number })[] = [];
  for (const leg of timeline) {
    const last = legs[legs.length - 1];
    if (last && last.kind === "move" && leg.kind === "move") {
      last.km += Number(leg.km) || 0;
      last.endedAt = leg.endedAt;
      last.to = leg.to;
    } else legs.push({ ...leg, km: Number(leg.km) || 0, minutes: 0 });
  }
  for (const leg of legs) {
    const span = (new Date(leg.endedAt).getTime() - new Date(leg.startedAt).getTime()) / 60_000;
    leg.minutes = Number.isFinite(span) ? span : 0;
  }
  return legs;
}

type RouteData = { kind: "day"; day: TrackingDay; consent?: TrackingConsent } | { kind: "shift"; day: TrackingDay; shift: ShiftRoute };

export default function Tracking() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("agent");
  const shiftId = params.get("shift");
  const routeDate = params.get("date") || todayString();
  const rawTab = params.get("tab");
  const tab: Tab = rawTab === "shifts" || rawTab === "days" ? rawTab : "route";
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const update = (changes: Record<string, string | null>, push = false) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(changes)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      },
      { replace: !push },
    );

  // ── Data ──────────────────────────────────────────────────────────────────
  const staff = useAsync(() => adminApi.allStaff(), []);
  const board = useAsync(async () => {
    const result = await Promise.all([adminApi.live(), adminApi.attendanceSummary()]);
    setUpdatedAt(new Date());
    return result;
  }, []);
  useInterval(() => board.reload(true), 30_000);
  useInterval(() => staff.reload(true), 180_000);

  const rows = useMemo(() => {
    const [live, attendance] = board.data ?? [[], { todayMap: {}, summaryMap: {} }];
    const fixes = new Map(live.map((f) => [String(f.agentId), f]));
    const list = (staff.data ?? [])
      .filter((a) => TRACKED_ROLES.includes(a.role) || fixes.has(a._id) || attendance.todayMap[a._id])
      .map((a) => describe(a, fixes.get(a._id) ?? null, attendance.todayMap[a._id] ?? null));
    return list.sort(
      (a, b) => rank(a) - rank(b) || (a.fix?.minutesAgo ?? Infinity) - (b.fix?.minutesAgo ?? Infinity) || a.agent.name.localeCompare(b.agent.name),
    );
  }, [staff.data, board.data]);
  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const selectedRow = selected ? rowsById.get(selected) : undefined;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "duty" && !r.onDuty) return false;
      if (filter === "live" && !r.live) return false;
      if (filter === "attention" && !r.attention) return false;
      return !q || [r.agent.name, r.agent.phone, r.agent.district, r.agent.employeeCode].some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  const route = useAsync<RouteData | null>(async () => {
    if (!selected || tab !== "route") return null;
    if (shiftId) {
      const r = await adminApi.shiftRoute(selected, shiftId);
      return { kind: "shift", day: r.shift.summary, shift: r.shift };
    }
    const r = await adminApi.agentDay(selected, routeDate);
    return { kind: "day", day: r.day, consent: r.agent.consent };
  }, [selected, shiftId, routeDate, tab]);

  // Keep today's route current while the agent is out.
  useInterval(() => {
    if (selected && tab === "route" && !shiftId && routeDate === todayString() && selectedRow?.onDuty) route.reload(true);
  }, 30_000);

  const shifts = useAsync(() => (selected && tab === "shifts" ? adminApi.agentAttendance(selected) : Promise.resolve(null)), [selected, tab]);
  const days = useAsync(() => (selected && tab === "days" ? adminApi.agentDays(selected) : Promise.resolve(null)), [selected, tab]);

  // ── Map ───────────────────────────────────────────────────────────────────
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useLeafletMap(mapEl);
  const layers = useRef<{ live: L.LayerGroup; route: L.LayerGroup } | null>(null);
  const fitted = useRef(false);
  const routeKey = useRef("");

  useEffect(() => {
    if (!map) return;
    layers.current = { route: L.layerGroup().addTo(map), live: L.layerGroup().addTo(map) };
    return () => {
      layers.current = null;
    };
  }, [map]);

  const fitToLive = (force: boolean) => {
    if (!map) return;
    const points = rows.flatMap((r) => (r.fix ? [L.latLng(r.fix.lat, r.fix.lng)] : r.checkInPoint ? [L.latLng(r.checkInPoint.lat, r.checkInPoint.lng)] : []));
    if (!points.length) {
      if (force) map.setView(INDIA.center, INDIA.zoom);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { ...fitPadding(50, Boolean(selected)), maxZoom: points.length === 1 ? 14 : 15 });
  };

  // Live markers.
  useEffect(() => {
    const live = layers.current?.live;
    if (!map || !live) return;
    live.clearLayers();
    for (const r of rows) {
      const point = r.fix ? [r.fix.lat, r.fix.lng] : r.checkInPoint ? [r.checkInPoint.lat, r.checkInPoint.lng] : null;
      if (!point || !point.every(Number.isFinite)) continue;
      const isSelected = r.id === selected;
      const dim = Boolean(selected) && !isSelected;
      const marker = L.circleMarker(point as L.LatLngTuple, r.fix
        ? { radius: isSelected ? 11 : 8, color: "#fff", weight: 2, opacity: dim ? 0.5 : 1, fillColor: COLORS[r.tone], fillOpacity: dim ? 0.35 : 1 }
        : { radius: isSelected ? 10 : 8, color: COLORS.nogps, weight: 3, opacity: dim ? 0.4 : 1, fillColor: "#fff", fillOpacity: dim ? 0.4 : 1 });
      const when = r.fix ? `GPS ${fmtAgo(r.fix.minutesAgo)}` : `Check-in point, ${fmtTime(r.today?.checkInTime)}`;
      marker.bindTooltip(`<strong>${escapeHtml(r.agent.name)}</strong><br>${escapeHtml(when)}`, { direction: "top", offset: [0, -8] });
      marker.on("click", () => update({ agent: r.id, shift: null, date: null, tab: null }, true));
      marker.addTo(live);
      if (isSelected) marker.bringToFront();
    }
    if (!fitted.current && board.data && staff.data) {
      fitted.current = true;
      if (!selected) fitToLive(false);
    }
  }, [map, rows, selected]);

  // The selected route.
  useEffect(() => {
    const layer = layers.current?.route;
    if (!map || !layer) return;
    layer.clearLayers();
    const data = route.data;
    if (!selected || tab !== "route" || !data) return;
    const day = data.day;
    const bounds = L.latLngBounds([]);
    const points = (day.route ?? []).filter(hasFix).map((p) => L.latLng(Number(p.lat), Number(p.lng)));
    if (points.length > 1) L.polyline(points, { color: COLORS.route, weight: 4, opacity: 0.85, lineJoin: "round" }).addTo(layer);
    points.forEach((p) => bounds.extend(p));
    for (const v of day.visited ?? []) {
      if (!hasFix(v)) continue;
      L.circleMarker([v.lat, v.lng], { radius: 7, color: "#fff", weight: 2, fillColor: COLORS.stop, fillOpacity: 0.9 })
        .bindTooltip(escapeHtml(`Stopped ${fmtDuration(v.minutes)} · ${fmtTime(v.arrivedAt)}–${fmtTime(v.leftAt)}`), { direction: "top" })
        .addTo(layer);
      bounds.extend([v.lat, v.lng]);
    }
    const pin = (p: L.LatLngExpression, cls: string, text: string, tip: string) => {
      L.marker(p, {
        icon: L.divIcon({ className: "", html: `<div class="pin ${cls}">${escapeHtml(text)}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
        zIndexOffset: 1000,
        keyboard: false,
      })
        .bindTooltip(escapeHtml(tip), { direction: "top", offset: [0, -14] })
        .addTo(layer);
      bounds.extend(p);
    };
    if (data.kind === "shift") {
      const s = data.shift;
      if (hasFix(s.checkIn)) pin([Number(s.checkIn.lat), Number(s.checkIn.lng)], "pin-in", "IN", `Checked in ${fmtTime(s.checkIn.at)}`);
      else if (points.length) pin(points[0], "pin-start", "S", `First point ${fmtTime(day.startedAt)}`);
      if (s.checkOut && hasFix(s.checkOut)) pin([Number(s.checkOut.lat), Number(s.checkOut.lng)], "pin-out", "OUT", `Checked out ${fmtTime(s.checkOut.at)}`);
      else if (points.length > 1) pin(points[points.length - 1], "pin-end", "E", `${s.onDuty ? "Latest" : "Last point"} ${fmtTime(day.endedAt)}`);
    } else if (points.length) {
      pin(points[0], "pin-start", "S", `Start ${fmtTime(day.startedAt)}`);
      if (points.length > 1) pin(points[points.length - 1], "pin-end", "E", `End ${fmtTime(day.endedAt)}`);
    }
    // Frame the route when a new one opens, not on every quiet refresh.
    const key = `${selected}|${shiftId ?? routeDate}`;
    if (routeKey.current !== key && bounds.isValid()) {
      routeKey.current = key;
      map.fitBounds(bounds, { ...fitPadding(60, true), maxZoom: 16 });
    }
  }, [map, route.data, selected, tab, shiftId, routeDate]);

  useEffect(() => {
    if (!selected) routeKey.current = "";
  }, [selected]);

  const focusLeg = (leg: TimelineLeg) => {
    if (!map) return;
    const start = new Date(leg.startedAt).getTime();
    const end = new Date(leg.endedAt).getTime();
    const bounds = L.latLngBounds([leg.from, leg.to]);
    for (const p of route.data?.day.route ?? []) {
      const t = new Date(p.recordedAt).getTime();
      if (t >= start && t <= end && hasFix(p)) bounds.extend([p.lat, p.lng]);
    }
    map.fitBounds(bounds, { ...fitPadding(80, true), maxZoom: leg.kind === "stop" ? 17 : 16 });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const counts = {
    all: rows.length,
    duty: rows.filter((r) => r.onDuty).length,
    live: rows.filter((r) => r.live).length,
    attention: rows.filter((r) => r.attention).length,
  };
  const isToday = routeDate >= todayString();

  return (
    <div className="tracking">
      <aside className="tracking-side">
        <div className="tracking-side-head">
          <div className="inline-gap between">
            <h1 className="h-tight">Live tracking</h1>
            <button type="button" className="icon-btn" title="Refresh" aria-label="Refresh" onClick={() => board.reload(true)}>
              <RefreshCw size={16} className={board.loading ? "spin" : ""} />
            </button>
          </div>
          <div className="chips">
            {(
              [
                ["all", "All"],
                ["duty", "On duty"],
                ["live", "Live"],
                ["attention", "No GPS"],
              ] as [Filter, string][]
            ).map(([value, label]) => (
              <button key={value} type="button" className={`chip${filter === value ? " active" : ""}${value === "attention" && counts.attention ? " chip-warn" : ""}`} onClick={() => setFilter(value)}>
                {label} <b>{counts[value]}</b>
              </button>
            ))}
          </div>
          <div className="search">
            <Search size={16} />
            <input placeholder="Search name, phone, district…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="muted small">
            {board.error ? <span className="danger-text">Update failed: {board.error.message}</span> : updatedAt ? `Updated ${fmtTime(updatedAt)} · every 30 s` : "Loading…"}
          </div>
        </div>
        {staff.error ? (
          <ErrorBox error={staff.error} onRetry={() => staff.reload()} />
        ) : !staff.data ? (
          <Spinner />
        ) : !visible.length ? (
          <Empty title={rows.length ? "Nobody matches" : "No field agents yet"}>{rows.length ? "Try another filter." : "Add field agents under Staff."}</Empty>
        ) : (
          <ul className="agent-list">
            {visible.map((r) => (
              <li key={r.id}>
                <button type="button" className={`agent-item${r.id === selected ? " selected" : ""}`} onClick={() => update({ agent: r.id, shift: null, date: null, tab: null }, true)}>
                  <span className={`dot dot-${r.tone}`} />
                  <span className="agent-name">{r.agent.name}</span>
                  <span className="agent-age">{r.fix ? fmtAgo(r.fix.minutesAgo) : ""}</span>
                  <span className={`agent-line${r.onDuty ? (r.live ? " text-green" : " text-amber") : ""}`}>{r.duty}</span>
                  <span className="agent-line">{place(r.agent)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="tracking-map">
        <div ref={mapEl} className="map" />
        <button type="button" className="map-button" onClick={() => fitToLive(true)}>
          <Crosshair size={15} /> Show everyone
        </button>
        <div className="map-legend">
          <span><i className="dot dot-live" /> Live</span>
          <span><i className="dot dot-recent" /> Last 2 h</span>
          <span><i className="dot dot-stale" /> Older</span>
          <span><i className="dot dot-nogps" /> Check-in point</span>
        </div>
      </div>

      {selected && (
        <section className="tracking-detail">
          <div className="detail-head">
            <div>
              <h2>{selectedRow?.agent.name ?? "Agent"}</h2>
              <div className="muted small">{[selectedRow?.agent.phone, place(selectedRow?.agent)].filter(Boolean).join(" · ")}</div>
            </div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => update({ agent: null, shift: null, date: null, tab: null }, true)}>
              <X size={18} />
            </button>
          </div>
          {selectedRow && (
            <div className="badges">
              <RoleBadge role={selectedRow.agent.role} />
              {selectedRow.onDuty ? (
                <Badge tone="green">On duty since {fmtTime(selectedRow.today?.checkInTime)}</Badge>
              ) : selectedRow.checkedOut ? (
                <Badge>Checked out {fmtTime(selectedRow.today?.checkOutTime)}</Badge>
              ) : (
                <Badge>Not checked in today</Badge>
              )}
              {selectedRow.fix ? (
                <Badge tone={selectedRow.live ? "green" : "amber"}>GPS {fmtAgo(selectedRow.fix.minutesAgo)}</Badge>
              ) : selectedRow.onDuty ? (
                <Badge tone="red">No live GPS</Badge>
              ) : null}
              {(() => {
                const consent = (route.data?.kind === "day" ? route.data.consent : undefined) ?? selectedRow.agent.trackingConsent;
                if (!consent) return null;
                return consent.granted ? <Badge tone="blue">Tracking on{consent.deviceLabel ? ` · ${consent.deviceLabel}` : ""}</Badge> : <Badge tone="red">Tracking off on phone</Badge>;
              })()}
            </div>
          )}

          <div className="tabs tabs-full" role="tablist">
            {(
              [
                ["route", "Route"],
                ["shifts", "Shifts"],
                ["days", "Tracked days"],
              ] as [Tab, string][]
            ).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} className={`tab${tab === value ? " active" : ""}`} onClick={() => update({ tab: value === "route" ? null : value, shift: null })}>
                {label}
              </button>
            ))}
          </div>

          <div className="detail-body">
            {tab === "route" && (
              <>
                {shiftId ? (
                  <div className="date-bar">
                    <Button size="sm" icon={<ArrowLeft size={15} />} onClick={() => update({ shift: null, tab: "shifts" })}>
                      Shifts
                    </Button>
                    <span className="small">
                      {route.data?.kind === "shift"
                        ? `Shift ${fmtDate(route.data.shift.date)} · ${fmtTime(route.data.shift.checkIn.at)} → ${
                            route.data.shift.checkOut ? fmtTime(route.data.shift.checkOut.at) : route.data.shift.onDuty ? "on duty" : "no check-out"
                          }`
                        : "Shift"}
                    </span>
                  </div>
                ) : (
                  <div className="date-bar">
                    <button type="button" className="icon-btn" aria-label="Previous day" onClick={() => update({ date: addDays(routeDate, -1) })}>
                      <ChevronLeft size={18} />
                    </button>
                    <input type="date" value={routeDate} max={todayString()} onChange={(e) => e.target.value && update({ date: e.target.value > todayString() ? null : e.target.value })} />
                    <button type="button" className="icon-btn" aria-label="Next day" disabled={isToday} onClick={() => update({ date: addDays(routeDate, 1) >= todayString() ? null : addDays(routeDate, 1) })}>
                      <ChevronRight size={18} />
                    </button>
                    {!isToday && (
                      <Button size="sm" onClick={() => update({ date: null })}>
                        Today
                      </Button>
                    )}
                  </div>
                )}
                <RouteBody route={route.data} loading={route.loading} error={route.error} row={selectedRow} isToday={isToday} onLeg={focusLeg} />
              </>
            )}

            {tab === "shifts" &&
              (shifts.error ? (
                <ErrorBox error={shifts.error} onRetry={() => shifts.reload()} />
              ) : !shifts.data ? (
                <Spinner />
              ) : (
                <>
                  <div className="metrics">
                    <Metric value={fmtKm(shifts.data.summary?.totalDistanceKm)} label="Total distance" />
                    <Metric value={String(shifts.data.summary?.totalDaysPresent ?? 0)} label="Days worked" />
                    <Metric value={fmtKm(shifts.data.summary?.averageKmPerDay)} label="Average a day" />
                  </div>
                  {!shifts.data.records.length ? (
                    <Empty title="No shifts yet">Shifts appear once the agent checks in.</Empty>
                  ) : (
                    <>
                      <h3 className="section-title">Recent shifts — open one to see its route</h3>
                      <ul className="rows">
                        {shifts.data.records.map((r) => {
                          const open = !r.checkedOut && r.date === todayString();
                          const end = r.checkedOut ? fmtTime(r.checkOutTime) : open ? "on duty" : "no check-out";
                          return (
                            <li key={r._id}>
                              <button type="button" className="row-item" disabled={!r.checkInTime} onClick={() => update({ tab: null, shift: r._id, date: null })}>
                                <span className="row-title">{fmtDate(r.date)}</span>
                                <span className="row-km">{fmtKm(r.distanceKm)}</span>
                                <span className="row-sub">
                                  {r.checkInTime ? `${fmtTime(r.checkInTime)} → ${end}${r.totalWorkingMinutes ? ` · ${fmtDuration(r.totalWorkingMinutes)}` : ""}` : "No check-in"}
                                </span>
                                <span className="row-side">
                                  <Badge tone={open ? "green" : r.status === "half_day" ? "amber" : "gray"}>{open ? "On duty" : ATTENDANCE_LABELS[r.status] ?? r.status}</Badge>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}
                </>
              ))}

            {tab === "days" &&
              (days.error ? (
                <ErrorBox error={days.error} onRetry={() => days.reload()} />
              ) : !days.data ? (
                <Spinner />
              ) : !days.data.length ? (
                <Empty title="No tracked days">Days with GPS points appear here. Points are kept for 180 days.</Empty>
              ) : (
                <>
                  <p className="muted small">
                    {days.data.length} tracked day{days.data.length === 1 ? "" : "s"} · {fmtKm(days.data.reduce((sum, d) => sum + (Number(d.totalKm) || 0), 0))} in total
                  </p>
                  <ul className="rows">
                    {days.data.map((d) => (
                      <li key={d.date}>
                        <button type="button" className="row-item" onClick={() => update({ tab: null, shift: null, date: d.date >= todayString() ? null : d.date })}>
                          <span className="row-title">{fmtDate(d.date)}</span>
                          <span className="row-km">{fmtKm(d.totalKm)}</span>
                          <span className="row-sub">
                            {fmtTime(d.firstAt)} – {fmtTime(d.lastAt)}
                          </span>
                          <span className="row-side muted small">{d.fixes} points</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="metric">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}

function PlaceLine({ label, point, at }: { label: string; point: { lat?: unknown; lng?: unknown; accuracy?: number | null; address?: string } | null | undefined; at?: unknown }) {
  if (!point || !hasFix(point)) return null;
  return (
    <p className="place-line">
      <b>{label}</b>
      {at ? ` at ${fmtTime(at)}` : ""}
      {point.address ? ` — ${point.address}` : ""}
      <br />
      <a href={mapsUrl(point.lat, point.lng)} target="_blank" rel="noopener noreferrer">
        {coordsText(point.lat, point.lng)}
      </a>
      {point.accuracy !== null && point.accuracy !== undefined && <span className="muted"> · ±{Math.round(Number(point.accuracy))} m</span>}
    </p>
  );
}

function RouteBody({
  route,
  loading,
  error,
  row,
  isToday,
  onLeg,
}: {
  route: RouteData | null | undefined;
  loading: boolean;
  error: Error | null;
  row?: Row;
  isToday: boolean;
  onLeg: (leg: TimelineLeg) => void;
}) {
  if (error) return <ErrorBox error={error} />;
  if (!route) return loading ? <Spinner label="Loading route…" /> : null;
  const day = route.day;
  const legs = mergeLegs(day.timeline);
  const hasRoute = (day.fixes ?? 0) > 0;

  if (!hasRoute && route.kind === "day") {
    let message = "No GPS points were recorded on this day.";
    if (route.consent && !route.consent.granted) message = "Tracking is switched off on this agent's phone, so no route is recorded.";
    else if (isToday && !row?.onDuty) message = "No GPS points yet today. Points are recorded between check-in and check-out.";
    else if (isToday) message = "On duty, but the phone has not sent any GPS points yet today.";
    return (
      <>
        <Empty title="No route">{message}</Empty>
        {row?.fix && (
          <p className="place-line">
            Last known position {fmtAgo(row.fix.minutesAgo)}:{" "}
            <a href={mapsUrl(row.fix.lat, row.fix.lng)} target="_blank" rel="noopener noreferrer">
              {coordsText(row.fix.lat, row.fix.lng)}
            </a>
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <div className="metrics">
        <Metric value={fmtKm(day.totalKm)} label="Distance" />
        <Metric value={fmtDuration(day.movingMinutes)} label="Moving" />
        <Metric value={fmtDuration(day.idleMinutes)} label="Stopped" />
        <Metric value={String(day.fixes ?? 0)} label="GPS points" />
        <Metric value={fmtTime(day.startedAt)} label="First point" />
        <Metric value={fmtTime(day.endedAt)} label="Last point" />
      </div>
      {route.kind === "shift" ? (
        <>
          {!hasFix(route.shift.checkIn) && <p className="place-line muted">No GPS fix was sent at check-in.</p>}
          <PlaceLine label="Checked in" point={route.shift.checkIn} at={route.shift.checkIn?.at} />
          <PlaceLine label="Checked out" point={route.shift.checkOut} at={route.shift.checkOut?.at} />
        </>
      ) : (
        day.latest && <PlaceLine label={isToday && row?.onDuty ? "Latest position" : "Last position"} point={day.latest} at={day.latest.recordedAt} />
      )}
      {legs.length > 0 ? (
        <>
          <h3 className="section-title">Timeline</h3>
          <ul className="timeline">
            {legs.map((leg, i) => (
              <li key={i}>
                <button type="button" className={`leg leg-${leg.kind}`} onClick={() => onLeg(leg)}>
                  <span className="leg-mark" />
                  <span className="leg-title">
                    {leg.kind === "move" ? `Moved ${fmtKm(leg.km)} · ${fmtDuration(leg.minutes)}` : leg.kind === "stop" ? `Stopped ${fmtDuration(leg.minutes)}` : `No GPS for ${fmtDuration(leg.minutes)}`}
                  </span>
                  <span className="leg-time">
                    {fmtTime(leg.startedAt)}–{fmtTime(leg.endedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        !hasRoute && <Empty title="No GPS points were recorded during this shift." />
      )}
    </>
  );
}
