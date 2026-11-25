import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Clock,
  MapPin,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";
import { adminApi } from "../../api";
import { LeadStatusBadge, RoleBadge } from "../../components/badges";
import { Badge, Button, Empty, ErrorBox, PageHeader, Spinner, StatCard } from "../../components/ui";
import { fmtAgo, fmtDate, fmtTime, ROLE_LABELS } from "../../format";
import { useAsync, useInterval } from "../../hooks";
import type { StaffRole } from "../../types";

const LIVE_MINUTES = 15;

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

  const view = useMemo(() => {
    if (!data.data) return null;
    const [stats, staff, attendance, live, recent] = data.data;
    const liveIds = new Set(live.filter((f) => f.minutesAgo <= LIVE_MINUTES).map((f) => f.agentId));
    const fixById = new Map(live.map((f) => [f.agentId, f]));
    const byRole = (Object.keys(ROLE_LABELS) as StaffRole[]).map((role) => ({
      role,
      total: staff.filter((s) => s.role === role).length,
      active: staff.filter((s) => s.role === role && s.status === "active").length,
    }));
    const team = staff
      .filter((s) => s.status === "active" && (s.role === "field_agent" || s.role === "field_supervisor"))
      .map((s) => {
        const today = attendance.todayMap[s._id];
        const onDuty = Boolean(today?.checkedIn && !today?.checkedOut);
        return { staff: s, today, onDuty, checkedOut: Boolean(today?.checkedOut), fix: fixById.get(s._id) };
      })
      .sort((a, b) => Number(b.onDuty) - Number(a.onDuty) || Number(b.checkedOut) - Number(a.checkedOut) || a.staff.name.localeCompare(b.staff.name));
    return {
      stats,
      staff,
      recent: recent.items,
      byRole,
      team,
      onDuty: team.filter((t) => t.onDuty).length,
      checkedOut: team.filter((t) => t.checkedOut).length,
      fieldTotal: team.length,
      liveCount: liveIds.size,
    };
  }, [data.data]);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        actions={
          <Button icon={<RefreshCw size={16} />} onClick={() => data.reload(true)}>
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
            <StatCard label="Pending review" value={view.stats.pending} tone="amber" icon={<Clock size={20} />} onClick={() => navigate("/leads?status=pending")} />
            <StatCard label="Approved" value={view.stats.approved} tone="green" icon={<CheckCircle2 size={20} />} onClick={() => navigate("/leads?status=approved")} />
            <StatCard label="Converted" value={view.stats.converted} tone="violet" icon={<Sparkles size={20} />} hint={`${view.stats.rejected} rejected`} onClick={() => navigate("/leads?status=converted")} />
            <StatCard
              label="On duty now"
              value={`${view.onDuty} / ${view.fieldTotal}`}
              tone="green"
              icon={<CalendarClock size={20} />}
              hint={`${view.checkedOut} checked out today`}
              onClick={() => navigate("/attendance")}
            />
            <StatCard label="Live on GPS" value={view.liveCount} tone="blue" icon={<MapPin size={20} />} hint={`Sent a location in the last ${LIVE_MINUTES} min`} onClick={() => navigate("/tracking")} />
            <StatCard label="Staff" value={view.staff.length} tone="indigo" icon={<Users size={20} />} hint={`${view.staff.filter((s) => s.status === "active").length} active`} onClick={() => navigate("/staff")} />
            <StatCard label="Meetings requested" value={view.stats.meetingsRequested} tone="amber" icon={<CalendarClock size={20} />} hint={`${view.stats.interested} owners interested`} />
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
                <h2>Field team today</h2>
                <Link to="/attendance">Attendance</Link>
              </div>
              {!view.team.length ? (
                <Empty title="No field agents yet">
                  Create them under <Link to="/staff">Staff</Link>.
                </Empty>
              ) : (
                <ul className="list">
                  {view.team.slice(0, 8).map(({ staff, today, onDuty, checkedOut, fix }) => (
                    <li key={staff._id}>
                      <Link to={`/tracking?agent=${staff._id}`} className="list-row">
                        <span className={`dot ${onDuty ? (fix && fix.minutesAgo <= LIVE_MINUTES ? "dot-live" : "dot-warn") : "dot-off"}`} />
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
