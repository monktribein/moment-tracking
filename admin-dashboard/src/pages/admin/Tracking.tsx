import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Crosshair, Layers, RefreshCw, Search, X } from "lucide-react";
import { adminApi, mapLimit } from "../../api";
import { RoleBadge } from "../../components/badges";
import { clearOverlays, fitMap, htmlMarker, INDIA, mapDot, useGoogleMap, type Overlay } from "../../components/useGoogleMap";
import { Badge, Button, Empty, ErrorBox, Spinner } from "../../components/ui";
import {
  addDays,
  ATTENDANCE_LABELS,
  coordsText,
  daySpan,
  fmtAgo,
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtKm,
  fmtTime,
  hasFix,
  mapsUrl,
  place,
  stopLetter,
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
function fitPadding(base: number, panelOpen: boolean): google.maps.Padding {
  const covered = panelOpen && window.matchMedia("(min-width: 961px)").matches;
  return { top: base, left: base, bottom: base, right: base + (covered ? 412 : 0) };
}

/** Where an agent shows on the map: the latest GPS fix, else a real check-in point. */
function pointOf(r: Row): google.maps.LatLngLiteral | null {
  const p = r.fix ?? r.checkInPoint;
  if (!p) return null;
  const point = { lat: Number(p.lat), lng: Number(p.lng) };
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) ? point : null;
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

// The history endpoint returns at most 90 days, and each day is one request.
const MAX_RANGE_DAYS = 90;

type Leg = ReturnType<typeof mergeLegs>[number] & { letter: string };
type DayLegs = { day: TrackingDay; legs: Leg[] };

type RouteData =
  | { kind: "day"; day: TrackingDay; consent?: TrackingConsent }
  | { kind: "shift"; day: TrackingDay; shift: ShiftRoute }
  | { kind: "range"; from: string; to: string; days: TrackingDay[]; consent?: TrackingConsent };

/** The days a route covers, oldest first. */
const daysOf = (route: RouteData): TrackingDay[] => (route.kind === "range" ? route.days : [route.day]);

/** Each day's trips and stops, with stops lettered A, B, C… in order, carrying on across days. */
function letterStops(days: TrackingDay[]): DayLegs[] {
  let stops = 0;
  return days.map((day) => ({ day, legs: mergeLegs(day.timeline).map((leg) => ({ ...leg, letter: leg.kind === "stop" ? stopLetter(stops++) : "" })) }));
}

/** A valid range from URL values: ordered, not past today, at most MAX_RANGE_DAYS long. */
function normalRange(from: string | null, to: string | null): { from: string; to: string } | null {
  const isDay = (v: string | null): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
  if (!isDay(from) || !isDay(to)) return null;
  let [start, end] = from <= to ? [from, to] : [to, from];
  const today = todayString();
  if (end > today) end = today;
  if (start > end) start = end;
  if (daySpan(start, end) > MAX_RANGE_DAYS) start = addDays(end, -(MAX_RANGE_DAYS - 1));
  return { from: start, to: end };
}

const toPoint = (p: { lat: unknown; lng: unknown }): google.maps.LatLngLiteral => ({ lat: Number(p.lat), lng: Number(p.lng) });

export default function Tracking() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("agent");
  const shiftId = params.get("shift");
  const routeDate = params.get("date") || todayString();
  const rawFrom = params.get("from");
  const rawTo = params.get("to");
  const range = useMemo(() => normalRange(rawFrom, rawTo), [rawFrom, rawTo]);
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
  // Opening an agent, a shift or a day starts from a clean period.
  const PERIOD_RESET = { shift: null, date: null, from: null, to: null };
  const openAgent = (id: string | null) => update({ agent: id, ...PERIOD_RESET, tab: null }, true);
  const setRange = (from: string, to: string) => {
    const r = normalRange(from, to);
    if (r) update({ ...PERIOD_RESET, from: r.from, to: r.to });
  };

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
    if (range) {
      // Only days with GPS points are loaded, a few at a time.
      const tracked = await adminApi.agentDays(selected, { startDate: range.from, endDate: range.to });
      const dates = tracked.map((d) => d.date).filter((d) => d >= range.from && d <= range.to).sort();
      const loaded = await mapLimit(dates, 6, (date) => adminApi.agentDay(selected, date));
      return { kind: "range", from: range.from, to: range.to, days: loaded.map((r, i) => ({ ...r.day, date: dates[i] })), consent: loaded[0]?.agent.consent };
    }
    const r = await adminApi.agentDay(selected, routeDate);
    return { kind: "day", day: r.day, consent: r.agent.consent };
  }, [selected, shiftId, routeDate, tab, range?.from, range?.to]);
  const lettered = useMemo(() => (route.data ? letterStops(daysOf(route.data)) : []), [route.data]);

  // Keep today's route current while the agent is out.
  useInterval(() => {
    const coversToday = (range ? range.to : routeDate) === todayString();
    if (selected && tab === "route" && !shiftId && coversToday && selectedRow?.onDuty) route.reload(true);
  }, 30_000);

  const shifts = useAsync(() => (selected && tab === "shifts" ? adminApi.agentAttendance(selected) : Promise.resolve(null)), [selected, tab]);
  const days = useAsync(() => (selected && tab === "days" ? adminApi.agentDays(selected) : Promise.resolve(null)), [selected, tab]);

  // ── Map ───────────────────────────────────────────────────────────────────
  const mapEl = useRef<HTMLDivElement>(null);
  const { map, error: mapError } = useGoogleMap(mapEl);
  const liveLayer = useRef<Overlay[]>([]);
  const routeLayer = useRef<Overlay[]>([]);
  const fitted = useRef(false);
  const routeKey = useRef("");
  const [satellite, setSatellite] = useState(false);

  useEffect(() => {
    map?.setMapTypeId(satellite ? "hybrid" : "roadmap");
  }, [map, satellite]);

  const fitToLive = (force: boolean) => {
    if (!map) return;
    const points = rows.flatMap((r) => pointOf(r) ?? []);
    if (!fitMap(map, points, fitPadding(50, Boolean(selected)), points.length === 1 ? 14 : 15) && force) {
      map.setCenter(INDIA.center);
      map.setZoom(INDIA.zoom);
    }
  };

  // Live markers. Route pins sit above them, route stops below.
  useEffect(() => {
    if (!map) return;
    clearOverlays(liveLayer.current);
    for (const r of rows) {
      const point = pointOf(r);
      if (!point) continue;
      const isSelected = r.id === selected;
      const dim = Boolean(selected) && !isSelected;
      const dot = r.fix
        ? mapDot(isSelected ? 24 : 18, COLORS[r.tone], "#fff", 2, dim ? 0.45 : 1)
        : mapDot(isSelected ? 23 : 19, "#fff", COLORS.nogps, 3, dim ? 0.4 : 1);
      const when = r.fix ? `GPS ${fmtAgo(r.fix.minutesAgo)}` : `Check-in point, ${fmtTime(r.today?.checkInTime)}`;
      liveLayer.current.push(
        htmlMarker(map, point, dot, { title: r.agent.name, text: when }, isSelected ? 20 : 10, () => openAgent(r.id)),
      );
    }
    if (!fitted.current && board.data && staff.data) {
      fitted.current = true;
      if (!selected) fitToLive(false);
    }
  }, [map, rows, selected]);

  // The selected route: one line per day, stops lettered A, B, C…, start and end pins.
  useEffect(() => {
    if (!map) return;
    const layer = routeLayer.current;
    clearOverlays(layer);
    const data = route.data;
    if (!selected || tab !== "route" || !data) return;
    const framed: google.maps.LatLngLiteral[] = [];
    let first: google.maps.LatLngLiteral | null = null;
    let last: google.maps.LatLngLiteral | null = null;
    for (const { day } of lettered) {
      const points = (day.route ?? []).filter(hasFix).map(toPoint);
      if (points.length > 1) layer.push(new google.maps.Polyline({ map, path: points, strokeColor: COLORS.route, strokeWeight: 4, strokeOpacity: 0.85, clickable: false }));
      for (const p of points) framed.push(p);
      if (points.length) {
        first ??= points[0];
        last = points[points.length - 1];
      }
    }
    const pin = (p: google.maps.LatLngLiteral, cls: string, text: string, tip: { title?: string; text: string }, zIndex = 30) => {
      const el = document.createElement("div");
      el.className = `pin ${cls}`;
      el.textContent = text;
      layer.push(htmlMarker(map, p, el, tip, zIndex));
      framed.push(p);
    };
    const multiDay = data.kind === "range";
    for (const { day, legs } of lettered)
      for (const leg of legs)
        if (leg.kind === "stop" && hasFix(leg.from))
          pin(toPoint(leg.from), "pin-stop", leg.letter, {
            title: `Stop ${leg.letter} · ${fmtDuration(leg.minutes)}`,
            text: `${multiDay ? `${fmtDate(day.date)} · ` : ""}${fmtTime(leg.startedAt)}–${fmtTime(leg.endedAt)}`,
          }, 25);
    const days = lettered.map((d) => d.day);
    const startedAt = days[0]?.startedAt;
    const endedAt = days[days.length - 1]?.endedAt;
    const when = (at: unknown) => (multiDay ? fmtDateTime(at) : fmtTime(at));
    if (data.kind === "shift") {
      const s = data.shift;
      if (hasFix(s.checkIn)) pin(toPoint(s.checkIn), "pin-in", "IN", { text: `Checked in ${fmtTime(s.checkIn.at)}` });
      else if (first) pin(first, "pin-start", "S", { text: `First point ${fmtTime(startedAt)}` });
      if (s.checkOut && hasFix(s.checkOut)) pin(toPoint(s.checkOut), "pin-out", "OUT", { text: `Checked out ${fmtTime(s.checkOut.at)}` });
      else if (last && last !== first) pin(last, "pin-end", "E", { text: `${s.onDuty ? "Latest" : "Last point"} ${fmtTime(endedAt)}` });
    } else if (first) {
      pin(first, "pin-start", "S", { text: `Start ${when(startedAt)}` });
      if (last && last !== first) pin(last, "pin-end", "E", { text: `End ${when(endedAt)}` });
    }
    // Frame the route when a new one opens, not on every quiet refresh.
    const key = `${selected}|${shiftId ?? (range ? `${range.from}..${range.to}` : routeDate)}`;
    if (routeKey.current !== key && framed.length) {
      routeKey.current = key;
      fitMap(map, framed, fitPadding(60, true), 16);
    }
  }, [map, lettered, route.data, selected, tab, shiftId, routeDate, range]);

  useEffect(() => {
    if (!selected) routeKey.current = "";
  }, [selected]);

  const focusLeg = (leg: TimelineLeg) => {
    if (!map) return;
    const start = new Date(leg.startedAt).getTime();
    const end = new Date(leg.endedAt).getTime();
    const points = [leg.from, leg.to].filter(hasFix).map(toPoint);
    for (const { day } of lettered)
      for (const p of day.route ?? []) {
        const t = new Date(p.recordedAt).getTime();
        if (t >= start && t <= end && hasFix(p)) points.push(toPoint(p));
      }
    fitMap(map, points, fitPadding(80, true), leg.kind === "stop" ? 17 : 16);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const counts = {
    all: rows.length,
    duty: rows.filter((r) => r.onDuty).length,
    live: rows.filter((r) => r.live).length,
    attention: rows.filter((r) => r.attention).length,
  };
  const isToday = routeDate >= todayString();
  const today = todayString();
  const RANGE_PRESETS: [string, string][] = [
    ["Last 7 days", addDays(today, -6)],
    ["Last 30 days", addDays(today, -29)],
    ["This month", `${today.slice(0, 8)}01`],
    ["Last 90 days", addDays(today, -(MAX_RANGE_DAYS - 1))],
  ];

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
                <button type="button" className={`agent-item${r.id === selected ? " selected" : ""}`} onClick={() => openAgent(r.id)}>
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
        {mapError ? (
          <div className="map-error" role="alert">
            {mapError}
          </div>
        ) : (
          <div className="map-tools">
            <button type="button" className="map-button" onClick={() => fitToLive(true)}>
              <Crosshair size={15} /> Show everyone
            </button>
            <button type="button" className={`map-button${satellite ? " active" : ""}`} aria-pressed={satellite} onClick={() => setSatellite((s) => !s)}>
              <Layers size={15} /> Satellite
            </button>
          </div>
        )}
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
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => openAgent(null)}>
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
                const consent = (route.data?.kind === "shift" ? undefined : route.data?.consent) ?? selectedRow.agent.trackingConsent;
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
                  <>
                    <div className="segmented" role="group" aria-label="Route period">
                      <button type="button" aria-pressed={!range} onClick={() => range && update({ ...PERIOD_RESET, date: range.to >= today ? null : range.to })}>
                        Single day
                      </button>
                      <button type="button" aria-pressed={Boolean(range)} onClick={() => !range && setRange(addDays(routeDate, -6), routeDate)}>
                        Date range
                      </button>
                    </div>
                    {range ? (
                      <>
                        <div className="date-bar">
                          <input type="date" aria-label="From" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange(e.target.value, range.to)} />
                          <span className="muted small">to</span>
                          <input type="date" aria-label="To" value={range.to} min={range.from} max={today} onChange={(e) => e.target.value && setRange(range.from, e.target.value)} />
                        </div>
                        <div className="chips">
                          {RANGE_PRESETS.map(([label, from]) => (
                            <button key={label} type="button" className={`chip${range.from === from && range.to === today ? " active" : ""}`} onClick={() => setRange(from, today)}>
                              {label}
                            </button>
                          ))}
                        </div>
                        <p className="muted small range-note">
                          {daySpan(range.from, range.to)} day{daySpan(range.from, range.to) === 1 ? "" : "s"} selected · up to {MAX_RANGE_DAYS} at a time
                        </p>
                      </>
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
                  </>
                )}
                <RouteBody
                  route={route.data}
                  lettered={lettered}
                  loading={route.loading}
                  error={route.error}
                  row={selectedRow}
                  isToday={range ? range.to >= today : isToday}
                  onLeg={focusLeg}
                  onOpenDay={(date) => update({ ...PERIOD_RESET, date: date >= today ? null : date })}
                />
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
                              <button type="button" className="row-item" disabled={!r.checkInTime} onClick={() => update({ ...PERIOD_RESET, tab: null, shift: r._id })}>
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
                        <button type="button" className="row-item" onClick={() => update({ ...PERIOD_RESET, tab: null, date: d.date >= todayString() ? null : d.date })}>
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
  lettered,
  loading,
  error,
  row,
  isToday,
  onLeg,
  onOpenDay,
}: {
  route: RouteData | null | undefined;
  lettered: DayLegs[];
  loading: boolean;
  error: Error | null;
  row?: Row;
  isToday: boolean;
  onLeg: (leg: TimelineLeg) => void;
  onOpenDay: (date: string) => void;
}) {
  if (error) return <ErrorBox error={error} />;
  if (!route) return loading ? <Spinner label="Loading route…" /> : null;
  const days = daysOf(route);
  const fixes = days.reduce((sum, d) => sum + (Number(d.fixes) || 0), 0);
  const stops = lettered.reduce((sum, d) => sum + d.legs.filter((l) => l.kind === "stop").length, 0);

  if (!fixes && route.kind !== "shift") {
    let message = route.kind === "range" ? `No GPS points were recorded from ${fmtDate(route.from)} to ${fmtDate(route.to)}.` : "No GPS points were recorded on this day.";
    if (route.consent && !route.consent.granted) message = "Tracking is switched off on this agent's phone, so no route is recorded.";
    else if (route.kind === "day" && isToday && !row?.onDuty) message = "No GPS points yet today. Points are recorded between check-in and check-out.";
    else if (route.kind === "day" && isToday) message = "On duty, but the phone has not sent any GPS points yet today.";
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

  if (route.kind === "range") {
    const sum = (key: "totalKm" | "movingMinutes" | "idleMinutes") => days.reduce((total, d) => total + (Number(d[key]) || 0), 0);
    const lastDay = days[days.length - 1];
    return (
      <>
        <div className="metrics">
          <Metric value={fmtKm(sum("totalKm"))} label="Distance" />
          <Metric value={fmtDuration(sum("movingMinutes"))} label="Moving" />
          <Metric value={fmtDuration(sum("idleMinutes"))} label="Stopped" />
          <Metric value={String(days.length)} label={days.length === 1 ? "Day tracked" : "Days tracked"} />
          <Metric value={String(stops)} label={stops === 1 ? "Stop" : "Stops"} />
          <Metric value={String(fixes)} label="GPS points" />
        </div>
        {lastDay?.latest && <PlaceLine label={isToday && row?.onDuty ? "Latest position" : "Last position"} point={lastDay.latest} at={lastDay.latest.recordedAt} />}
        <h3 className="section-title">Day by day — stops are lettered in order</h3>
        {lettered.map(({ day, legs }) => {
          const dayStops = legs.filter((l) => l.kind === "stop");
          return (
            <section key={day.date} className="range-day">
              <button type="button" className="row-item" onClick={() => day.date && onOpenDay(day.date)} title="Open this day">
                <span className="row-title">{fmtDate(day.date)}</span>
                <span className="row-km">{fmtKm(day.totalKm)}</span>
                <span className="row-sub">
                  {fmtTime(day.startedAt)} – {fmtTime(day.endedAt)}
                  {dayStops.length ? ` · stops ${dayStops[0].letter}${dayStops.length > 1 ? `–${dayStops[dayStops.length - 1].letter}` : ""}` : " · no stops"}
                </span>
                <span className="row-side muted small">Open day</span>
              </button>
              {legs.length > 0 && <LegList legs={legs} onLeg={onLeg} />}
            </section>
          );
        })}
      </>
    );
  }

  const day = route.day;
  const legs = lettered[0]?.legs ?? [];
  return (
    <>
      <div className="metrics">
        <Metric value={fmtKm(day.totalKm)} label="Distance" />
        <Metric value={fmtDuration(day.movingMinutes)} label="Moving" />
        <Metric value={fmtDuration(day.idleMinutes)} label={`Stopped · ${stops} stop${stops === 1 ? "" : "s"}`} />
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
          <h3 className="section-title">Timeline — stops are lettered in order</h3>
          <LegList legs={legs} onLeg={onLeg} />
        </>
      ) : (
        !fixes && <Empty title="No GPS points were recorded during this shift." />
      )}
    </>
  );
}

/** Trips and stops in order; a stop shows its letter, the same one as its pin on the map. */
function LegList({ legs, onLeg }: { legs: Leg[]; onLeg: (leg: TimelineLeg) => void }) {
  return (
    <ul className="timeline">
      {legs.map((leg, i) => (
        <li key={i}>
          <button type="button" className={`leg leg-${leg.kind}`} onClick={() => onLeg(leg)}>
            {leg.letter ? <span className="leg-letter">{leg.letter}</span> : <span className="leg-mark" />}
            <span className="leg-title">
              {leg.kind === "move" ? `Moved ${fmtKm(leg.km)} · ${fmtDuration(leg.minutes)}` : leg.kind === "stop" ? `Stop ${leg.letter} · ${fmtDuration(leg.minutes)}` : `No GPS for ${fmtDuration(leg.minutes)}`}
            </span>
            <span className="leg-time">
              {fmtTime(leg.startedAt)}–{fmtTime(leg.endedAt)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
