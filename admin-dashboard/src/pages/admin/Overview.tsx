import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarClock, ClipboardList, Clock, RefreshCw, Users } from "lucide-react";
import { adminApi, mapLimit } from "../../api";
import { LeadStatusBadge, RoleBadge } from "../../components/badges";
import { ColumnChart, RingMeter, SegmentedBar, type Column, type Segment } from "../../components/charts";
import { Badge, Button, Empty, ErrorBox, PageHeader, Spinner, StatCard } from "../../components/ui";
import { addDays, dateString, fmtAgo, fmtDate, fmtKm, fmtTime, ROLE_LABELS, todayString } from "../../format";
import { useAsync, useInterval } from "../../hooks";
import type { StaffRole } from "../../types";

const LIVE_MINUTES = 15;
const TREND_DAYS = 14;
const FIELD_ROLES = ["field_agent", "field_supervisor"];

// Validated as a set (adjacent CVD and normal-vision separation); yellow takes dark text.
const PIPELINE: { key: "pending" | "approved" | "converted" | "rejected"; label: string; color: string; ink: string }[] = [
  { key: "pending", label: "Pending review", color: "#eda100", ink: "#0b0b0b" },
  { key: "approved", label: "Approved", color: "#008300", ink: "#ffffff" },
  { key: "converted", label: "Converted", color: "#6250d6", ink: "#ffffff" },
  { key: "rejected", label: "Rejected", color: "#e34948", ink: "#ffffff" },
];

/** The last TREND_DAYS days, oldest first, as empty columns keyed by YYYY-MM-DD. */
function trendDays(): Column[] {
  const today = todayString();
  return Array.from({ length: TREND_DAYS }, (_, i) => {
    const key = addDays(today, i - (TREND_DAYS - 1));
    const d = new Date(`${key}T12:00:00`);
    return {
      key,
      label: d.toLocaleDateString([], { day: "numeric", month: "short" }),
      fullLabel: d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }),
      value: 0,
    };
  });
}

export default function Overview() {
  const navigate = useNavigate();
  const data = useAsync(
    () =>
      Promise.all([
        adminApi.leadStats(),
        adminApi.allStaff(),
        adminApi.attendanceSummary(),
        adminApi.live(),
        adminApi.leads({ page: 1, limit: 6 }),
      ]),
    [],
  );
  useInterval(() => data.reload(true), 60_000);

  // Daily trends load separately so the page does not wait for them.
  const trends = useAsync(async () => {
    const since = addDays(todayString(), -(TREND_DAYS - 1));
    const [leads, staff] = await Promise.all([adminApi.leadsSince(new Date(`${since}T00:00:00`)), adminApi.allStaff()]);
    const field = staff.filter((s) => FIELD_ROLES.includes(s.role));
    const histories = await mapLimit(field, 6, (s) => adminApi.agentDays(s._id, { startDate: since, endDate: todayString() }));

    const leadDays = trendDays();
    const leadIndex = new Map(leadDays.map((d, i) => [d.key, i]));
    for (const lead of leads) {
      const at = new Date(lead.capturedAt ?? lead.createdAt ?? "");
      const i = Number.isNaN(at.getTime()) ? undefined : leadIndex.get(dateString(at));
      if (i !== undefined) leadDays[i].value += 1;
    }
    const kmDays = trendDays();
    const kmIndex = new Map(kmDays.map((d, i) => [d.key, i]));
    for (const day of histories.flat()) {
      const i = kmIndex.get(day.date);
      if (i !== undefined) kmDays[i].value += Number(day.totalKm) || 0;
    }
    return { leadDays, kmDays };
  }, []);
  useInterval(() => trends.reload(true), 300_000);

  const [tables, setTables] = useState({ leads: false, km: false });

  const view = useMemo(() => {
    if (!data.data) return null;
    const [stats, staff, attendance, live, recent] = data.data;
    const fixById = new Map(live.map((f) => [f.agentId, f]));
    const byRole = (Object.keys(ROLE_LABELS) as StaffRole[]).map((role) => ({
      role,
      total: staff.filter((s) => s.role === role).length,
      active: staff.filter((s) => s.role === role && s.status === "active").length,
    }));
    const team = staff
      .filter((s) => s.status === "active" && FIELD_ROLES.includes(s.role))
      .map((s) => {
        const today = attendance.todayMap[s._id];
        const onDuty = Boolean(today?.checkedIn && !today?.checkedOut);
        const fix = fixById.get(s._id);
        return { staff: s, today, onDuty, checkedOut: Boolean(today?.checkedOut), fix, live: Boolean(fix && fix.minutesAgo <= LIVE_MINUTES) };
      })
      .sort((a, b) => Number(b.onDuty) - Number(a.onDuty) || Number(b.checkedOut) - Number(a.checkedOut) || a.staff.name.localeCompare(b.staff.name));
    const pipeline: Segment[] = PIPELINE.map((p) => ({ ...p, value: Number(stats[p.key]) || 0, to: `/leads?status=${p.key}` }));
    return {
      stats,
      staff,
      recent: recent.items,
      byRole,
      team,
      pipeline,
      onDuty: team.filter((t) => t.onDuty).length,
      checkedIn: team.filter((t) => t.onDuty || t.checkedOut).length,
      checkedOut: team.filter((t) => t.checkedOut).length,
      liveCount: team.filter((t) => t.live).length,
      fieldTotal: team.length,
    };
  }, [data.data]);

  const leadTotal14 = trends.data?.leadDays.reduce((sum, d) => sum + d.value, 0) ?? 0;
  const kmTotal14 = trends.data?.kmDays.reduce((sum, d) => sum + d.value, 0) ?? 0;
  const refresh = () => {
    data.reload(true);
    trends.reload(true);
  };

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        actions={
          <Button icon={<RefreshCw size={16} className={data.loading || trends.loading ? "spin" : ""} />} onClick={refresh}>
            Refresh
          </Button>
        }
      />

      {data.error && !data.data ? (
        <ErrorBox error={data.error} onRetry={() => data.reload()} />
      ) : !view ? (
        <Spinner />
      ) : (
        <>
          <div className="stat-grid">
            <StatCard label="Total leads" value={view.stats.total} hint={`${view.stats.capturedLast7Days} in the last 7 days`} icon={<ClipboardList size={20} />} onClick={() => navigate("/leads")} />
            <StatCard label="Pending review" value={view.stats.pending} tone="amber" icon={<Clock size={20} />} hint="Waiting for a decision" onClick={() => navigate("/leads?status=pending")} />
            <StatCard label="Meetings requested" value={view.stats.meetingsRequested} tone="violet" icon={<CalendarClock size={20} />} hint={`${view.stats.interested} owners interested`} />
            <StatCard label="Staff" value={view.staff.length} tone="blue" icon={<Users size={20} />} hint={`${view.staff.filter((s) => s.status === "active").length} active`} onClick={() => navigate("/staff")} />
          </div>

          <div className="two-col">
            <section className="card">
              <div className="card-head">
                <h2>Field team today</h2>
                <Link to="/tracking">Live tracking</Link>
              </div>
              {!view.fieldTotal ? (
                <Empty title="No field agents yet">
                  Create them under <Link to="/staff">Staff</Link>.
                </Empty>
              ) : (
                <div className="ring-row">
                  <RingMeter value={view.checkedIn} total={view.fieldTotal} label="Checked in today" hint={`${view.checkedOut} checked out`} to="/attendance" />
                  <RingMeter value={view.onDuty} total={view.fieldTotal} label="On duty now" hint="Checked in, not out" to="/attendance" />
                  <RingMeter value={view.liveCount} total={view.fieldTotal} label="Live on GPS" hint={`Location in last ${LIVE_MINUTES} min`} to="/tracking" />
                </div>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Lead pipeline</h2>
                <Link to="/leads">All leads</Link>
              </div>
              <div className="pipeline-head">
                <span className="pipeline-total">{view.stats.total}</span>
                <span className="muted small">
                  leads in total · {view.stats.total ? Math.round(((view.stats.approved + view.stats.converted) / view.stats.total) * 100) : 0}% approved or converted
                </span>
              </div>
              <SegmentedBar parts={view.pipeline} emptyText="No leads yet" />
            </section>
          </div>

          <div className="two-col">
            <ChartCard
              title="Leads added"
              summary={trends.data ? `${leadTotal14} in the last ${TREND_DAYS} days` : ""}
              table={tables.leads}
              onToggleTable={() => setTables((t) => ({ ...t, leads: !t.leads }))}
              state={trends}
            >
              {trends.data && <ColumnChart data={trends.data.leadDays} format={(v) => String(v)} wholeNumbers title={`Leads added per day, last ${TREND_DAYS} days`} showTable={tables.leads} />}
            </ChartCard>
            <ChartCard
              title="Distance travelled by the field team"
              summary={trends.data ? `${fmtKm(kmTotal14)} in the last ${TREND_DAYS} days` : ""}
              table={tables.km}
              onToggleTable={() => setTables((t) => ({ ...t, km: !t.km }))}
              state={trends}
            >
              {trends.data && <ColumnChart data={trends.data.kmDays} format={(v) => fmtKm(v)} title={`Kilometres travelled per day by all field staff, last ${TREND_DAYS} days`} showTable={tables.km} />}
            </ChartCard>
          </div>

          <div className="two-col">
            <section className="card">
              <div className="card-head">
                <h2>Recent leads</h2>
                <Link to="/leads">View all</Link>
              </div>
              {!view.recent.length ? (
                <Empty title="No leads yet">Leads added by lead executives, agents or you appear here.</Empty>
              ) : (
                <ul className="list">
                  {view.recent.map((lead) => (
                    <li key={lead._id}>
                      <Link to={`/leads?lead=${lead._id}`} className="list-row">
                        <div className="list-main">
                          <div className="cell-title">{lead.name}</div>
                          <div className="cell-sub">
                            {lead.capturedByName || "—"} · {fmtDate(lead.capturedAt ?? lead.createdAt)}
                            {lead.assignedAgentName ? ` · → ${lead.assignedAgentName}` : ""}
                          </div>
                        </div>
                        {!lead.assignedAgentName && lead.status === "pending" && <Badge>Unassigned</Badge>}
                        <LeadStatusBadge status={lead.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Field team</h2>
                <Link to="/attendance">Attendance</Link>
              </div>
              {!view.team.length ? (
                <Empty title="No field agents yet">
                  Create them under <Link to="/staff">Staff</Link>.
                </Empty>
              ) : (
                <ul className="list">
                  {view.team.slice(0, 8).map(({ staff, today, onDuty, checkedOut, fix, live }) => (
                    <li key={staff._id}>
                      <Link to={`/tracking?agent=${staff._id}`} className="list-row">
                        <span className={`dot ${onDuty ? (live ? "dot-live" : "dot-warn") : "dot-off"}`} />
                        <div className="list-main">
                          <div className="cell-title">{staff.name}</div>
                          <div className="cell-sub">
                            {onDuty
                              ? `On duty since ${fmtTime(today?.checkInTime)}${fix ? ` · GPS ${fmtAgo(fix.minutesAgo)}` : " · no GPS yet"}`
                              : checkedOut
                                ? `Checked out at ${fmtTime(today?.checkOutTime)}`
                                : "Not checked in today"}
                          </div>
                        </div>
                        {onDuty ? <Badge tone="green">On duty</Badge> : checkedOut ? <Badge>Done</Badge> : <Badge tone="gray">Off</Badge>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="card">
            <div className="card-head">
              <h2>Staff by role</h2>
              <Link to="/staff">Manage staff</Link>
            </div>
            <div className="role-grid">
              {view.byRole.map((r) => (
                <div key={r.role} className="role-tile">
                  <RoleBadge role={r.role} />
                  <div className="role-count">{r.total}</div>
                  <div className="muted small">
                    {r.active} active{r.total - r.active ? ` · ${r.total - r.active} suspended` : ""}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}

/** A chart card: title and total, a Chart/Table switch, and the previous chart kept (dimmed) while it reloads. */
function ChartCard({
  title,
  summary,
  table,
  onToggleTable,
  state,
  children,
}: {
  title: string;
  summary: string;
  table: boolean;
  onToggleTable: () => void;
  state: { data?: unknown; error: Error | null; loading: boolean; reload: (silent?: boolean) => void };
  children: ReactNode;
}) {
  return (
    <section className="card chart-card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {summary && <div className="muted small">{summary}</div>}
        </div>
        <button type="button" className="chip" aria-pressed={table} onClick={onToggleTable} disabled={!state.data}>
          {table ? "Chart" : "Table"}
        </button>
      </div>
      {state.error && !state.data ? (
        <ErrorBox error={state.error} onRetry={() => state.reload()} />
      ) : !state.data ? (
        <Spinner label="Loading…" />
      ) : (
        <div className={state.loading ? "chart-body reloading" : "chart-body"}>{children}</div>
      )}
    </section>
  );
}
