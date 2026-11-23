/*
 * Movement Tracking — Super Admin panel.
 * A static page: every piece of data comes from the guarded /api routes with the
 * admin's token, so the panel can see nothing the API would not show.
 */
"use strict";

(() => {
  // ── Settings ───────────────────────────────────────────────────────────────
  const LIVE_MINUTES = 15; // a fix this recent counts as live
  const RECENT_MINUTES = 120;
  const REFRESH_MS = 30_000;
  const AGENTS_EVERY = 4; // reload the agent list on every 4th refresh
  const TOKEN_KEY = "mt-admin-token";
  // Check-ins the server placed at the district centre on sign-in: not a real GPS fix.
  const LOGIN_CHECK_IN_NOTES = ["Shift login check-in", "Initial shift login attendance"];
  const INDIA = { center: [22.6, 79.0], zoom: 5 };
  const COLORS = {
    live: "#16a34a",
    recent: "#d97706",
    stale: "#94a3b8",
    nogps: "#2563eb",
    route: "#3f51d8",
    stop: "#7c3aed",
  };
  const ROLE_LABELS = {
    field_agent: "Field agent",
    field_supervisor: "Supervisor",
    lead_executive: "Lead executive",
    document_verifier: "Document verifier",
  };
  const STATUS_LABELS = {
    present: "Present",
    half_day: "Half day",
    checked_in: "Checked in",
    checked_out: "Checked out",
    absent: "Absent",
  };

  // ── Small helpers ──────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  const pad = (n) => String(n).padStart(2, "0");
  const dateString = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayString = () => dateString(new Date());
  const addDays = (day, days) => {
    const d = new Date(`${day}T12:00:00`);
    d.setDate(d.getDate() + days);
    return dateString(d);
  };
  const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const hasFix = (c) =>
    c != null && Number.isFinite(num(c.lat)) && Number.isFinite(num(c.lng)) && !(num(c.lat) === 0 && num(c.lng) === 0);
  const realCheckIn = (log) =>
    hasFix(log?.checkInCoords) && !LOGIN_CHECK_IN_NOTES.includes(String(log?.notes ?? ""));
  const idOf = (agent) => String(agent?._id ?? agent?.id ?? "");
  const place = (a) => [a?.district, a?.state].filter(Boolean).join(", ");

  const fmtTime = (v) =>
    v ? new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
  const fmtClock = (d) =>
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fmtDate = (day) => {
    if (!day) return "—";
    const d = new Date(`${day}T12:00:00`);
    if (Number.isNaN(d.getTime())) return String(day);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString([], {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(sameYear ? {} : { year: "numeric" }),
    });
  };
  const fmtKm = (km) => {
    const n = Number(km) || 0;
    return `${n < 10 ? n.toFixed(2) : n.toFixed(1)} km`;
  };
  const fmtDuration = (minutes) => {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    const h = Math.floor(m / 60);
    return h ? `${h}h ${m % 60}m` : `${m}m`;
  };
  const fmtAgo = (minutes) => {
    if (minutes == null) return "";
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
    return `${Math.floor(minutes / 1440)}d ago`;
  };
  const mapsUrl = (lat, lng) => `https://www.google.com/maps?q=${num(lat)},${num(lng)}`;
  const coordsText = (lat, lng) => `${num(lat).toFixed(5)}, ${num(lng).toFixed(5)}`;

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    token: sessionStorage.getItem(TOKEN_KEY),
    admin: null,
    agents: [],
    agentsLoaded: false,
    live: new Map(), // agentId → newest fix (last 12 h)
    today: {}, // agentId → today's attendance record
    fetchedAt: 0,
    rows: [],
    rowsById: new Map(),
    filter: "all",
    search: "",
    selected: null,
    tab: "route",
    routeDate: todayString(),
    shift: null, // { id } while a single shift is shown
    timer: null,
    tick: 0,
    refreshing: false,
    fitted: false,
    tickets: { route: 0, list: 0 },
  };

  const setToken = (token) => {
    state.token = token;
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  };

  // ── API ────────────────────────────────────────────────────────────────────
  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
  }

  async function api(path, { method = "GET", body } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const sentToken = state.token;
    if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

    let response;
    try {
      response = await fetch(`../api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      throw new ApiError("Cannot reach the server. Check your connection.", 0);
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      /* empty or non-JSON body */
    }

    if (response.status === 401 && sentToken) {
      if (state.token === sentToken) signOut("Your session has ended. Please sign in again.");
      throw new ApiError("Session ended", 401);
    }
    if (!response.ok || payload?.success === false) {
      const raw = payload?.message;
      const message = Array.isArray(raw) ? raw.join(". ") : raw;
      throw new ApiError(message || `Request failed (${response.status})`, response.status);
    }
    return payload?.data;
  }

  async function loadAgents() {
    const all = [];
    for (let page = 1; page <= 50; page += 1) {
      const data = await api(`/lead-collection/admin/users?limit=100&page=${page}`);
      const items = data?.items ?? [];
      all.push(...items);
      if (!items.length || all.length >= Number(data?.total ?? 0)) break;
    }
    state.agents = all;
    state.agentsLoaded = true;
  }

  // ── Map ────────────────────────────────────────────────────────────────────
  let map = null;
  let liveLayer = null;
  let routeLayer = null;
  const markers = new Map(); // agentId → live marker

  function initMap() {
    if (map) return;
    map = L.map("map", { zoomControl: true }).setView(INDIA.center, INDIA.zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    liveLayer = L.layerGroup().addTo(map);

    const FitControl = L.Control.extend({
      options: { position: "topright" },
      onAdd() {
        const button = L.DomUtil.create("button", "map-control");
        button.type = "button";
        button.textContent = "Show all agents";
        L.DomEvent.disableClickPropagation(button);
        L.DomEvent.on(button, "click", () => fitToLive(true));
        return button;
      },
    });
    new FitControl().addTo(map);
    new ResizeObserver(() => map.invalidateSize()).observe($("map"));
  }

  function fitToLive(force) {
    const points = [...markers.values()].map((m) => m.getLatLng());
    if (!points.length) {
      if (force) map.setView(INDIA.center, INDIA.zoom);
      return;
    }
    if (points.length === 1) map.setView(points[0], 14);
    else map.fitBounds(L.latLngBounds(points), { padding: [50, 50], maxZoom: 15 });
  }

  // ── Agent rows ─────────────────────────────────────────────────────────────
  function describe(agent, elapsedMinutes) {
    const id = idOf(agent);
    const fix = state.live.get(id) ?? null;
    const minutes = fix ? Math.max(0, Number(fix.minutesAgo ?? 0) + elapsedMinutes) : null;
    const today = state.today[id] ?? null;
    const onDuty = Boolean(today?.checkedIn && !today?.checkedOut);
    const checkedOut = Boolean(today?.checkedOut);
    const tone = fix
      ? minutes <= LIVE_MINUTES
        ? "live"
        : minutes <= RECENT_MINUTES
          ? "recent"
          : "stale"
      : onDuty
        ? "nogps"
        : "off";
    const live = tone === "live";

    let duty = "Not checked in today";
    let dutyClass = "";
    if (onDuty) {
      duty = `On duty since ${fmtTime(today.checkInTime)}`;
      dutyClass = live ? "duty-on" : "duty-warn";
      if (!live) duty += fix ? " · GPS not updating" : " · no GPS";
    } else if (checkedOut) {
      duty = `Checked out at ${fmtTime(today.checkOutTime)}`;
    }

    return {
      id,
      agent,
      fix,
      minutes,
      today,
      onDuty,
      checkedOut,
      tone,
      live,
      attention: onDuty && !live,
      checkInPoint: onDuty && realCheckIn(today) ? today.checkInCoords : null,
      duty,
      dutyClass,
    };
  }

  function buildRows() {
    const elapsed = state.fetchedAt ? Math.floor((Date.now() - state.fetchedAt) / 60_000) : 0;
    const rows = state.agents.map((agent) => describe(agent, elapsed));
    // A fix from an agent missing from the list (deleted since) is still shown.
    const known = new Set(rows.map((r) => r.id));
    for (const [id, fix] of state.live)
      if (!known.has(id)) rows.push(describe({ _id: id, name: fix.agentName || "Unknown agent" }, elapsed));
    state.rows = rows;
    state.rowsById = new Map(rows.map((r) => [r.id, r]));
    return rows;
  }

  const rank = (r) => (r.live ? 0 : r.attention ? 1 : r.fix ? 2 : 3);
  const compareRows = (a, b) =>
    rank(a) - rank(b) ||
    (a.minutes ?? Infinity) - (b.minutes ?? Infinity) ||
    String(a.agent.name ?? "").localeCompare(String(b.agent.name ?? ""));

  function visibleRows() {
    const q = state.search.trim().toLowerCase();
    return state.rows
      .filter((r) => {
        if (state.filter === "duty" && !r.onDuty) return false;
        if (state.filter === "live" && !r.live) return false;
        if (state.filter === "attention" && !r.attention) return false;
        if (!q) return true;
        const a = r.agent;
        return [a.name, a.phone, a.district, a.state, a.employeeCode].some((v) =>
          String(v ?? "").toLowerCase().includes(q),
        );
      })
      .sort(compareRows);
  }

  // ── Rendering: sidebar & live map ──────────────────────────────────────────
  function renderAll() {
    buildRows();
    renderStats();
    renderList();
    renderLive();
    if (state.selected) renderDetailHeader();
  }

  function renderStats() {
    const rows = state.rows;
    $("stat-all").textContent = rows.length;
    $("stat-duty").textContent = rows.filter((r) => r.onDuty).length;
    $("stat-live").textContent = rows.filter((r) => r.live).length;
    $("stat-attention").textContent = rows.filter((r) => r.attention).length;
    document.querySelectorAll(".stat").forEach((el) => {
      const active = el.dataset.filter === state.filter;
      el.classList.toggle("active", active);
      el.setAttribute("aria-selected", String(active));
    });
  }

  function renderList() {
    const list = $("agent-list");
    const shown = visibleRows();
    if (!shown.length) {
      list.innerHTML = state.rows.length
        ? '<li class="list-empty">No agents match this filter.</li>'
        : '<li class="list-empty">No field agents yet.<br>Add them through the API — see the <a href="../api/docs" target="_blank" rel="noopener">API docs</a>.</li>';
      return;
    }
    list.innerHTML = shown
      .map((r) => {
        const a = r.agent;
        const second = [place(a), ROLE_LABELS[a.role]].filter(Boolean).join(" · ");
        return `<li class="agent-item${r.id === state.selected ? " selected" : ""}" data-id="${esc(r.id)}" tabindex="0">
          <span class="dot dot-${r.tone}"></span>
          <span class="agent-name">${esc(a.name)}</span>
          <span class="agent-age">${r.fix ? esc(fmtAgo(r.minutes)) : ""}</span>
          <span class="agent-line ${r.dutyClass}">${esc(r.duty)}</span>
          ${second ? `<span class="agent-line">${esc(second)}</span>` : ""}
        </li>`;
      })
      .join("");
  }

  function markerStyle(r) {
    const selected = r.id === state.selected;
    const dim = Boolean(state.selected) && !selected;
    if (r.fix)
      return {
        radius: selected ? 11 : 8,
        color: "#ffffff",
        weight: 2,
        opacity: dim ? 0.5 : 1,
        fillColor: COLORS[r.tone],
        fillOpacity: dim ? 0.35 : 1,
      };
    return {
      radius: selected ? 10 : 8,
      color: COLORS.nogps,
      weight: 3,
      opacity: dim ? 0.4 : 1,
      fillColor: "#ffffff",
      fillOpacity: dim ? 0.4 : 1,
    };
  }

  function popupFor(r) {
    const el = document.createElement("div");
    el.className = "popup";
    if (!r) {
      el.textContent = "This agent is no longer listed.";
      return el;
    }
    const where = r.fix ? [r.fix.lat, r.fix.lng] : [r.checkInPoint.lat, r.checkInPoint.lng];
    const when = r.fix
      ? `GPS ${fmtAgo(r.minutes)} (${fmtTime(r.fix.recordedAt)})`
      : `Check-in point at ${fmtTime(r.today?.checkInTime)}, no live GPS`;
    el.innerHTML = `<strong>${esc(r.agent.name)}</strong>
      <span class="muted">${esc(place(r.agent)) || "&nbsp;"}</span>
      <div>${esc(r.duty)}</div>
      <div class="muted">${esc(when)}</div>
      <a href="${esc(mapsUrl(where[0], where[1]))}" target="_blank" rel="noopener">${esc(coordsText(where[0], where[1]))}</a>`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-primary btn-sm";
    button.textContent = "View route & shifts";
    button.addEventListener("click", () => {
      map.closePopup();
      selectAgent(r.id);
    });
    el.appendChild(button);
    return el;
  }

  function renderLive() {
    const seen = new Set();
    for (const r of state.rows) {
      const point = r.fix ? [num(r.fix.lat), num(r.fix.lng)] : r.checkInPoint ? [num(r.checkInPoint.lat), num(r.checkInPoint.lng)] : null;
      if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
      seen.add(r.id);
      const kind = r.fix ? "fix" : "checkin";
      let marker = markers.get(r.id);
      if (marker && marker.options.kind !== kind) {
        liveLayer.removeLayer(marker);
        markers.delete(r.id);
        marker = null;
      }
      if (!marker) {
        const id = r.id;
        marker = L.circleMarker(point, { ...markerStyle(r), kind });
        marker.bindTooltip("", { direction: "top", offset: [0, -8], className: "agent-label" });
        marker.bindPopup(() => popupFor(state.rowsById.get(id)));
        marker.addTo(liveLayer);
        markers.set(id, marker);
      } else {
        marker.setLatLng(point);
        marker.setStyle(markerStyle(r));
        if (marker.isPopupOpen()) marker.setPopupContent(popupFor(r));
      }
      marker.setTooltipContent(esc(r.agent.name));
      if (r.id === state.selected) marker.bringToFront();
    }
    for (const [id, marker] of markers)
      if (!seen.has(id)) {
        liveLayer.removeLayer(marker);
        markers.delete(id);
      }
  }

  function setStatus(text, isError = false) {
    const el = $("refresh-status");
    el.textContent = text;
    el.classList.toggle("error", isError);
  }

  // ── Refresh loop ───────────────────────────────────────────────────────────
  async function refresh({ agents = false } = {}) {
    if (state.refreshing || !state.token) return;
    state.refreshing = true;
    state.tick += 1;
    const reloadAgents = agents || !state.agentsLoaded || state.tick % AGENTS_EVERY === 0;
    setStatus("Updating…");
    try {
      const [live, attendance] = await Promise.all([
        api("/lead-collection/admin/tracking/live"),
        api("/lead-collection/admin/attendance/summary"),
        reloadAgents ? loadAgents() : Promise.resolve(),
      ]);
      state.live = new Map((live ?? []).map((fix) => [String(fix.agentId), fix]));
      state.today = attendance?.todayMap ?? {};
      state.fetchedAt = Date.now();
      renderAll();
      if (!state.fitted) {
        state.fitted = true;
        fitToLive(false);
      }
      setStatus(`Updated ${fmtClock(new Date())} · refreshes every 30 s`);
      // Keep an open "today" route current while the agent is moving.
      if (state.selected && state.tab === "route" && !state.shift && state.routeDate === todayString())
        loadDay({ silent: true });
    } catch (error) {
      if (error.status !== 401) setStatus(`Update failed: ${error.message}`, true);
    } finally {
      state.refreshing = false;
    }
  }

  function startTimer() {
    stopTimer();
    state.timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, REFRESH_MS);
  }

  function stopTimer() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  // ── Agent detail ───────────────────────────────────────────────────────────
  function selectAgent(id) {
    if (state.selected !== id) {
      state.selected = id;
      state.routeDate = todayString();
      state.shift = null;
      state.tab = "route";
    }
    $("detail").hidden = false;
    renderDetailHeader();
    setTab(state.tab);
    renderList();
    renderLive();
    loadTab();
  }

  function closeDetail() {
    state.selected = null;
    state.shift = null;
    state.tickets.route += 1;
    state.tickets.list += 1;
    routeLayer.clearLayers();
    $("detail").hidden = true;
    renderList();
    renderLive();
  }

  function renderDetailHeader() {
    const r = state.rowsById.get(state.selected);
    if (!r) return;
    const a = r.agent;
    $("detail-name").textContent = a.name || "Agent";
    $("detail-meta").textContent = [ROLE_LABELS[a.role] ?? a.role, a.phone, place(a)].filter(Boolean).join(" · ");
    const badges = [];
    if (r.onDuty) badges.push(`<span class="badge badge-green">On duty since ${esc(fmtTime(r.today.checkInTime))}</span>`);
    else if (r.checkedOut) badges.push(`<span class="badge">Checked out at ${esc(fmtTime(r.today.checkOutTime))}</span>`);
    else badges.push('<span class="badge">Not checked in today</span>');
    if (r.fix) badges.push(`<span class="badge ${r.live ? "badge-green" : "badge-amber"}">GPS ${esc(fmtAgo(r.minutes))}</span>`);
    else if (r.onDuty) badges.push('<span class="badge badge-red">No live GPS</span>');
    if (a.trackingConsent) {
      const label = a.trackingConsent.deviceLabel ? ` · ${esc(a.trackingConsent.deviceLabel)}` : "";
      badges.push(
        a.trackingConsent.granted
          ? `<span class="badge badge-blue">Tracking on${label}</span>`
          : '<span class="badge badge-red">Tracking off on phone</span>',
      );
    }
    if (a.status === "suspended") badges.push('<span class="badge badge-red">Suspended</span>');
    $("detail-badges").innerHTML = badges.join("");
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll(".tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tab);
      b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    });
    document.querySelectorAll(".tab-panel").forEach((p) => {
      p.hidden = p.dataset.panel !== tab;
    });
  }

  function loadTab() {
    if (state.tab === "route") return state.shift ? loadShift(state.shift.id) : loadDay();
    if (state.tab === "shifts") return loadShifts();
    return loadDays();
  }

  const agentPath = (id) => `/lead-collection/admin/agents/${encodeURIComponent(id)}`;
  const loadingHtml = (text) => `<div class="loading">${esc(text)}</div>`;
  const errorHtml = (error) => `<div class="error-box">${esc(error.message || "Something went wrong.")}</div>`;

  async function loadDay({ silent = false } = {}) {
    const id = state.selected;
    const day = state.routeDate;
    const ticket = ++state.tickets.route;
    state.shift = null;
    $("shift-bar").hidden = true;
    $("date-bar").hidden = false;
    $("route-date").value = day;
    $("route-date").max = todayString();
    $("day-next").disabled = day >= todayString();
    if (!silent) $("route-body").innerHTML = loadingHtml("Loading route…");
    try {
      const data = await api(`${agentPath(id)}/tracking?date=${encodeURIComponent(day)}`);
      if (ticket !== state.tickets.route) return;
      const row = state.rowsById.get(id);
      if (row && data?.agent?.consent) {
        row.agent.trackingConsent = { ...(row.agent.trackingConsent ?? {}), ...data.agent.consent };
        renderDetailHeader();
      }
      renderRoute(data.day, { shift: null, consent: data?.agent?.consent, fit: !silent });
    } catch (error) {
      if (ticket !== state.tickets.route || error.status === 401) return;
      if (!silent) {
        routeLayer.clearLayers();
        $("route-body").innerHTML = errorHtml(error);
      }
    }
  }

  async function loadShift(attendanceId) {
    const id = state.selected;
    const ticket = ++state.tickets.route;
    state.shift = { id: attendanceId };
    setTab("route");
    $("date-bar").hidden = true;
    $("shift-bar").hidden = false;
    $("shift-title").textContent = "Loading shift…";
    $("route-body").innerHTML = loadingHtml("Loading shift route…");
    try {
      const data = await api(`${agentPath(id)}/shifts/${encodeURIComponent(attendanceId)}/route`);
      if (ticket !== state.tickets.route) return;
      const s = data.shift;
      const end = s.checkOut ? fmtTime(s.checkOut.at) : s.onDuty ? "on duty" : "not checked out";
      $("shift-title").textContent = `Shift ${fmtDate(s.date)} · ${fmtTime(s.checkIn.at)} → ${end} (${fmtDuration(s.shiftMinutes)})`;
      renderRoute(s.summary, { shift: s, fit: true });
    } catch (error) {
      if (ticket !== state.tickets.route || error.status === 401) return;
      routeLayer.clearLayers();
      $("shift-title").textContent = "Shift";
      $("route-body").innerHTML = errorHtml(error);
    }
  }

  function addPin(latlng, cls, text, tip) {
    L.marker(latlng, {
      icon: L.divIcon({ className: "", html: `<div class="pin ${cls}">${esc(text)}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      zIndexOffset: 1000,
      keyboard: false,
    })
      .bindTooltip(esc(tip), { direction: "top", offset: [0, -14] })
      .addTo(routeLayer);
  }

  function drawRoute(day, shift, fit) {
    routeLayer.clearLayers();
    const bounds = L.latLngBounds([]);
    const points = (day?.route ?? [])
      .map((p) => [num(p.lat), num(p.lng)])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));

    if (points.length > 1) {
      L.polyline(points, { color: COLORS.route, weight: 4, opacity: 0.85, lineJoin: "round" }).addTo(routeLayer);
    }
    points.forEach((p) => bounds.extend(p));

    for (const v of day?.visited ?? []) {
      if (!hasFix(v)) continue;
      L.circleMarker([num(v.lat), num(v.lng)], { radius: 7, color: "#ffffff", weight: 2, fillColor: COLORS.stop, fillOpacity: 0.9 })
        .bindTooltip(esc(`Stopped ${fmtDuration(v.minutes)} · ${fmtTime(v.arrivedAt)}–${fmtTime(v.leftAt)}`), { direction: "top" })
        .addTo(routeLayer);
      bounds.extend([num(v.lat), num(v.lng)]);
    }

    const stillMoving = shift ? shift.onDuty : state.routeDate === todayString() && state.rowsById.get(state.selected)?.onDuty;
    if (shift) {
      if (shift.checkIn?.lat != null) {
        const p = [num(shift.checkIn.lat), num(shift.checkIn.lng)];
        addPin(p, "pin-in", "IN", `Checked in ${fmtTime(shift.checkIn.at)}`);
        bounds.extend(p);
      } else if (points.length) addPin(points[0], "pin-start", "S", `First fix ${fmtTime(day.startedAt)}`);
      if (shift.checkOut?.lat != null) {
        const p = [num(shift.checkOut.lat), num(shift.checkOut.lng)];
        addPin(p, "pin-out", "OUT", `Checked out ${fmtTime(shift.checkOut.at)}`);
        bounds.extend(p);
      } else if (points.length > 1) addPin(points[points.length - 1], "pin-end", "E", `${stillMoving ? "Latest" : "Last fix"} ${fmtTime(day.endedAt)}`);
    } else if (points.length) {
      addPin(points[0], "pin-start", "S", `Start ${fmtTime(day.startedAt)}`);
      if (points.length > 1) addPin(points[points.length - 1], "pin-end", "E", `${stillMoving ? "Latest" : "End"} ${fmtTime(day.endedAt)}`);
    }

    if (fit && bounds.isValid()) map.fitBounds(bounds, { ...fitPadding(), maxZoom: 16 });
  }

  function metricsHtml(day) {
    const metric = (value, label) =>
      `<div class="metric"><div class="metric-value">${esc(value)}</div><div class="metric-label">${esc(label)}</div></div>`;
    return `<div class="metrics">
      ${metric(fmtKm(day.totalKm), "Distance")}
      ${metric(fmtDuration(day.movingMinutes), "Moving")}
      ${metric(fmtDuration(day.idleMinutes), "Stopped")}
      ${metric(String(day.fixes ?? 0), "GPS points")}
      ${metric(fmtTime(day.startedAt), "First fix")}
      ${metric(fmtTime(day.endedAt), "Last fix")}
    </div>`;
  }

  function placeLine(label, point, at) {
    if (!point || !hasFix(point)) return "";
    const address = point.address ? ` — ${esc(point.address)}` : "";
    return `<p class="place-line"><b>${esc(label)}</b>${at ? ` at ${esc(fmtTime(at))}` : ""}${address}<br>
      <a href="${esc(mapsUrl(point.lat, point.lng))}" target="_blank" rel="noopener">${esc(coordsText(point.lat, point.lng))}</a>
      ${point.accuracy != null ? `<span class="muted"> · ±${esc(Math.round(num(point.accuracy)))} m</span>` : ""}</p>`;
  }

  /**
   * The server reports movement fix by fix (often one leg per minute). Back-to-back
   * moves are joined into one, so the timeline reads as trips and stops.
   */
  function mergeLegs(timeline) {
    const legs = [];
    for (const leg of timeline ?? []) {
      const last = legs[legs.length - 1];
      if (last && last.kind === "move" && leg.kind === "move") {
        last.km += Number(leg.km) || 0;
        last.endedAt = leg.endedAt;
        last.to = leg.to;
      } else {
        legs.push({ ...leg, km: Number(leg.km) || 0 });
      }
    }
    for (const leg of legs) {
      const span = (new Date(leg.endedAt).getTime() - new Date(leg.startedAt).getTime()) / 60_000;
      leg.minutes = Number.isFinite(span) ? span : Number(leg.minutes) || 0;
    }
    return legs;
  }

  /** Room for the detail drawer when it is drawn over the map (narrower windows). */
  function fitPadding(base = 60) {
    const drawer = $("detail");
    const overlays = !drawer.hidden && window.matchMedia("(min-width: 761px) and (max-width: 1200px)").matches;
    return { paddingTopLeft: [base, base], paddingBottomRight: [base + (overlays ? drawer.offsetWidth : 0), base] };
  }

  function timelineHtml(day) {
    const legs = (state.currentLegs = mergeLegs(day?.timeline));
    if (!legs.length) return "";
    const items = legs
      .map((leg, index) => {
        const title =
          leg.kind === "move"
            ? `Moved ${fmtKm(leg.km)} · ${fmtDuration(leg.minutes)}`
            : leg.kind === "stop"
              ? `Stopped ${fmtDuration(leg.minutes)}`
              : `No GPS for ${fmtDuration(leg.minutes)}`;
        return `<li class="leg leg-${esc(leg.kind)}" data-leg="${index}" tabindex="0">
          <span class="leg-mark"></span>
          <span class="leg-title">${esc(title)}</span>
          <span class="leg-time">${esc(fmtTime(leg.startedAt))}–${esc(fmtTime(leg.endedAt))}</span>
        </li>`;
      })
      .join("");
    return `<h3 class="section-title">Timeline</h3><ul class="timeline" id="timeline">${items}</ul>`;
  }

  function renderRoute(day, { shift, consent, fit }) {
    state.currentDay = day;
    drawRoute(day, shift, fit);
    const body = $("route-body");
    const hasRoute = (day?.fixes ?? 0) > 0;

    if (!hasRoute && !shift) {
      const row = state.rowsById.get(state.selected);
      const isToday = state.routeDate === todayString();
      let message = "No GPS points were recorded on this day.";
      if (consent && !consent.granted) message = "Tracking is switched off on this agent's phone, so no route is recorded.";
      else if (isToday && !row?.onDuty) message = "No GPS points yet today. Points are recorded between check-in and check-out.";
      else if (isToday) message = "On duty, but the phone has not sent any GPS points yet today.";
      const latest = row?.fix ? `<p class="place-line">Last known position ${esc(fmtAgo(row.minutes))}: <a href="${esc(mapsUrl(row.fix.lat, row.fix.lng))}" target="_blank" rel="noopener">${esc(coordsText(row.fix.lat, row.fix.lng))}</a></p>` : "";
      body.innerHTML = `<div class="empty"><strong>No route</strong>${esc(message)}</div>${latest}`;
      return;
    }

    let places = "";
    if (shift) {
      places = placeLine("Checked in", shift.checkIn, shift.checkIn?.at) + placeLine("Checked out", shift.checkOut, shift.checkOut?.at);
      if (!shift.checkIn || shift.checkIn.lat == null) places = `<p class="place-line muted">No GPS fix was sent at check-in.</p>${places}`;
    } else if (day.latest) {
      const isLive = state.routeDate === todayString() && state.rowsById.get(state.selected)?.onDuty;
      places = placeLine(isLive ? "Latest position" : "Last position", day.latest, day.latest.recordedAt);
    }

    body.innerHTML = `${metricsHtml(day)}${places}${timelineHtml(day) || (hasRoute ? "" : '<div class="empty">No GPS points were recorded during this shift.</div>')}`;
  }

  function focusLeg(index) {
    const leg = state.currentLegs?.[index];
    if (!leg) return;
    const start = new Date(leg.startedAt).getTime();
    const end = new Date(leg.endedAt).getTime();
    const bounds = L.latLngBounds([
      [num(leg.from.lat), num(leg.from.lng)],
      [num(leg.to.lat), num(leg.to.lng)],
    ]);
    // A trip is framed by every point it passed, not just its two ends.
    for (const p of state.currentDay?.route ?? []) {
      const t = new Date(p.recordedAt).getTime();
      if (t >= start && t <= end && hasFix(p)) bounds.extend([num(p.lat), num(p.lng)]);
    }
    map.fitBounds(bounds, { ...fitPadding(80), maxZoom: leg.kind === "stop" ? 17 : 16 });
  }

  async function loadShifts() {
    const id = state.selected;
    const ticket = ++state.tickets.list;
    const body = $("shifts-body");
    body.innerHTML = loadingHtml("Loading shifts…");
    try {
      const data = await api(`/lead-collection/admin/attendance/agent/${encodeURIComponent(id)}?limit=31`);
      if (ticket !== state.tickets.list) return;
      const s = data?.summary ?? {};
      const records = data?.records ?? [];
      const today = todayString();
      const metric = (value, label) =>
        `<div class="metric"><div class="metric-value">${esc(value)}</div><div class="metric-label">${esc(label)}</div></div>`;
      const top = `<div class="metrics">
          ${metric(fmtKm(s.totalDistanceKm), "Total distance")}
          ${metric(String(s.totalDaysPresent ?? 0), "Days worked")}
          ${metric(fmtKm(s.averageKmPerDay), "Avg per day")}
        </div>`;
      if (!records.length) {
        body.innerHTML = `${top}<div class="empty"><strong>No shifts yet</strong>Shifts appear here once the agent checks in.</div>`;
        return;
      }
      const rows = records
        .map((r) => {
          const canOpen = Boolean(r.checkInTime);
          const open = !r.checkedOut && r.date === today;
          const end = r.checkedOut ? fmtTime(r.checkOutTime) : open ? "on duty" : "not checked out";
          const hours = r.totalWorkingMinutes ? ` · ${fmtDuration(r.totalWorkingMinutes)}` : "";
          const label = open ? "On duty" : STATUS_LABELS[r.status] ?? r.status ?? "";
          const tone = open ? "badge-green" : r.status === "present" ? "" : r.status === "half_day" ? "badge-amber" : "";
          return `<li class="row${canOpen ? " clickable" : ""}" ${canOpen ? `data-shift="${esc(r._id)}" tabindex="0"` : ""}>
            <span class="row-title">${esc(fmtDate(r.date))}</span>
            <span class="row-km">${esc(fmtKm(r.distanceKm))}</span>
            <span class="row-sub">${canOpen ? `${esc(fmtTime(r.checkInTime))} → ${esc(end)}${esc(hours)}` : "No check-in"}</span>
            <span class="row-side"><span class="badge ${tone}">${esc(label)}</span></span>
          </li>`;
        })
        .join("");
      body.innerHTML = `${top}<h3 class="section-title">Recent shifts — click one to see its route</h3><ul class="rows">${rows}</ul>`;
    } catch (error) {
      if (ticket !== state.tickets.list || error.status === 401) return;
      body.innerHTML = errorHtml(error);
    }
  }

  async function loadDays() {
    const id = state.selected;
    const ticket = ++state.tickets.list;
    const body = $("days-body");
    body.innerHTML = loadingHtml("Loading tracked days…");
    try {
      const days = await api(`${agentPath(id)}/tracking/history`);
      if (ticket !== state.tickets.list) return;
      if (!days?.length) {
        body.innerHTML = '<div class="empty"><strong>No tracked days</strong>Days with GPS points appear here. Raw points are kept for 180 days.</div>';
        return;
      }
      const total = days.reduce((sum, d) => sum + (Number(d.totalKm) || 0), 0);
      const rows = days
        .map(
          (d) => `<li class="row clickable" data-day="${esc(d.date)}" tabindex="0">
            <span class="row-title">${esc(fmtDate(d.date))}</span>
            <span class="row-km">${esc(fmtKm(d.totalKm))}</span>
            <span class="row-sub">${esc(fmtTime(d.firstAt))} – ${esc(fmtTime(d.lastAt))}</span>
            <span class="row-side muted">${esc(d.fixes)} points</span>
          </li>`,
        )
        .join("");
      body.innerHTML = `<p class="muted">${esc(days.length)} tracked day${days.length === 1 ? "" : "s"} · ${esc(fmtKm(total))} in total</p>
        <h3 class="section-title">Click a day to see its route</h3><ul class="rows">${rows}</ul>`;
    } catch (error) {
      if (ticket !== state.tickets.list || error.status === 401) return;
      body.innerHTML = errorHtml(error);
    }
  }

  function showDay(day) {
    state.routeDate = day > todayString() ? todayString() : day;
    state.shift = null;
    setTab("route");
    loadDay();
  }

  // ── Screens ────────────────────────────────────────────────────────────────
  function showLogin(message = "") {
    $("app-view").hidden = true;
    $("login-view").hidden = false;
    const error = $("login-error");
    error.textContent = message;
    error.hidden = !message;
    setTimeout(() => $(($("login-email").value ? "login-password" : "login-email")).focus(), 0);
  }

  function showApp() {
    $("login-view").hidden = true;
    $("app-view").hidden = false;
    $("admin-name").textContent = state.admin?.name || state.admin?.email || "";
    initMap();
    map.invalidateSize();
    refresh({ agents: true });
    startTimer();
  }

  function signOut(message = "") {
    stopTimer();
    setToken(null);
    Object.assign(state, {
      admin: null,
      agents: [],
      agentsLoaded: false,
      live: new Map(),
      today: {},
      rows: [],
      rowsById: new Map(),
      selected: null,
      shift: null,
      fitted: false,
      refreshing: false,
    });
    state.tickets.route += 1;
    state.tickets.list += 1;
    if (map) {
      liveLayer.clearLayers();
      routeLayer.clearLayers();
      markers.clear();
      map.setView(INDIA.center, INDIA.zoom);
    }
    $("detail").hidden = true;
    $("agent-list").innerHTML = "";
    setStatus("");
    showLogin(message);
  }

  async function boot() {
    if (!state.token) return showLogin();
    try {
      state.admin = await api("/auth/me");
      showApp();
    } catch (error) {
      if (error.status !== 401) showLogin(error.message);
    }
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    if (!email || !password) return showLogin("Enter your email and password.");
    const button = $("login-submit");
    button.disabled = true;
    button.textContent = "Signing in…";
    try {
      const session = await api("/auth/login", { method: "POST", body: { email, password } });
      setToken(session.token);
      state.admin = session.admin;
      $("login-password").value = "";
      showApp();
    } catch (error) {
      showLogin(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Sign in";
    }
  });

  $("logout-btn").addEventListener("click", () => signOut());
  $("refresh-btn").addEventListener("click", () => {
    refresh({ agents: true });
    if (state.selected) loadTab();
  });

  $("stats").addEventListener("click", (event) => {
    const tile = event.target.closest(".stat");
    if (!tile) return;
    state.filter = state.filter === tile.dataset.filter ? "all" : tile.dataset.filter;
    renderStats();
    renderList();
  });

  $("agent-search").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderList();
  });

  const activate = (container, selector, handler) => {
    container.addEventListener("click", (event) => {
      const item = event.target.closest(selector);
      if (item && !event.target.closest("a")) handler(item);
    });
    container.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const item = event.target.closest(selector);
      if (!item) return;
      event.preventDefault();
      handler(item);
    });
  };

  activate($("agent-list"), ".agent-item", (item) => {
    // Jump to the agent now; their route, once loaded, re-frames the map.
    const marker = markers.get(item.dataset.id);
    if (marker) map.setView(marker.getLatLng(), Math.max(map.getZoom(), 13));
    selectAgent(item.dataset.id);
  });
  activate($("route-body"), ".leg", (item) => focusLeg(Number(item.dataset.leg)));
  activate($("shifts-body"), "[data-shift]", (item) => loadShift(item.dataset.shift));
  activate($("days-body"), "[data-day]", (item) => showDay(item.dataset.day));

  $("detail-close").addEventListener("click", closeDetail);
  document.querySelectorAll(".tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      setTab(tab.dataset.tab);
      loadTab();
    }),
  );

  $("day-prev").addEventListener("click", () => showDay(addDays(state.routeDate, -1)));
  $("day-next").addEventListener("click", () => showDay(addDays(state.routeDate, 1)));
  $("day-today").addEventListener("click", () => showDay(todayString()));
  $("route-date").addEventListener("change", (event) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) showDay(event.target.value);
  });
  $("shift-back").addEventListener("click", () => {
    state.shift = null;
    loadDay();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.selected && !$("password-dialog").open) closeDetail();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.admin) refresh();
  });

  // Change password
  const dialog = $("password-dialog");
  const showPwMessage = (text, isError) => {
    const el = $("pw-message");
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle("error", Boolean(isError));
  };
  $("password-btn").addEventListener("click", () => {
    $("password-form").reset();
    showPwMessage("");
    dialog.showModal();
  });
  $("pw-cancel").addEventListener("click", () => dialog.close());
  $("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentPassword = $("pw-current").value;
    const newPassword = $("pw-new").value;
    if (!currentPassword) return showPwMessage("Enter your current password.", true);
    if (newPassword.length < 10) return showPwMessage("The new password needs at least 10 characters.", true);
    if (newPassword !== $("pw-repeat").value) return showPwMessage("The two new passwords do not match.", true);
    if (newPassword === currentPassword) return showPwMessage("Choose a password different from the current one.", true);
    const button = $("pw-submit");
    button.disabled = true;
    try {
      const session = await api("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
      if (session?.token) setToken(session.token);
      if (session?.admin) state.admin = session.admin;
      $("password-form").reset();
      showPwMessage("Password changed. Other sessions were signed out.");
      setTimeout(() => dialog.open && dialog.close(), 1500);
    } catch (error) {
      if (error.status !== 401) showPwMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  boot();
})();
