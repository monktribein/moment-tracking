import { useNavigate } from "react-router-dom";
import { BarChart3, CalendarClock, CheckCircle2, Clock, FileText, Headset, PieChart, RefreshCw, UserCog, Users, Wrench, Zap } from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { words } from "../../eco/format";
import { Donut, ECO_COLORS, TrendChart, changePct } from "../../eco/charts";
import { StatusBadge } from "../../eco/ui";
import { Kpi, Panel, QuickTile, sumOf } from "../../eco/widgets";
import { ErrorBox, Spinner } from "../../components/ui";
import { useAsync } from "../../hooks";

/** Support manager dashboard (design page 10), all figures from GET /dashboard/support-manager. */
export function SupportHome() {
  const navigate = useNavigate();
  const d = useAsync(() => eco.dashboard("support-manager"), []);
  const x = d.data;
  if (d.error) return <ErrorBox error={d.error} onRetry={() => d.reload()} />;
  if (!x) return <Spinner />;
  const c = x.complaints ?? {};
  const trend: Row[] = x.trend ?? [];
  const engineers: Row[] = x.engineers ?? [];
  const avg = x.avgHoursToClose;
  const resolved = (c.resolved ?? 0) + (c.closed ?? 0);
  const inProgress = (c.assigned ?? 0) + (c.in_progress ?? 0) + (c.pending ?? 0);
  const open = (c.open ?? 0) + (c.reopened ?? 0);

  return (
    <>
      <div className="kpi-grid">
        <Kpi icon={<Headset size={22} />} tone="blue" label="Total complaints" value={sumOf(c)} delta={changePct(trend, "received")} goodWhenDown hint="change = received this month" to="/complaints" />
        <Kpi icon={<Clock size={22} />} tone="orange" label="Open (awaiting engineer)" value={open} to="/complaints?status=open" />
        <Kpi icon={<RefreshCw size={22} />} tone="green" label="In progress" value={inProgress} to="/complaints?status=in_progress" />
        <Kpi icon={<CheckCircle2 size={22} />} tone="teal" label="Resolved / closed" value={resolved} delta={changePct(trend, "closed")} to="/complaints?status=resolved" />
        <Kpi icon={<CalendarClock size={22} />} tone="violet" label="Avg. resolution time" value={avg === null || avg === undefined ? "—" : avg >= 48 ? `${(avg / 24).toFixed(1)} days` : `${avg} h`} />
        <Kpi icon={<Users size={22} />} tone="blue" label="Field engineers" value={engineers.length} />
      </div>

      <div className="dash-grid">
        <Panel title="Complaint trend" icon={<BarChart3 size={18} />}>
          <TrendChart data={trend} bar={{ key: "received", label: "Complaints received" }} line={{ key: "closed", label: "Closed" }} />
        </Panel>
        <Panel title="Complaints by status" icon={<PieChart size={18} />} action={{ label: "View all", to: "/complaints" }}>
          <Donut
            empty="No complaints yet."
            parts={[
              { key: "resolved", label: "Resolved / closed", value: resolved, color: ECO_COLORS.green },
              { key: "progress", label: "In progress", value: inProgress, color: ECO_COLORS.blueBright },
              { key: "open", label: "Open", value: open, color: ECO_COLORS.orange },
            ]}
          />
        </Panel>
        <Panel title="Field team status" icon={<Users size={18} />}>
          {!engineers.length ? (
            <p className="muted">No field engineers yet. The Super Admin adds them under Employees.</p>
          ) : (
            <ul className="mini-list">
              {engineers.map((e) => (
                <li key={e.engineerId}>
                  <span className="mini-icon" style={{ background: e.activeJobs ? ECO_COLORS.orange : ECO_COLORS.green }}><Wrench size={14} /></span>
                  <div className="mini-main">
                    <div className="cell-title">{e.name}</div>
                    <div className="cell-sub">{e.reportsLast30Days} reports in 30 days</div>
                  </div>
                  <StatusBadge status={e.activeJobs ? "in_progress" : "completed"} label={e.activeJobs ? `${e.activeJobs} active` : "Free"} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="dash-grid">
        <Panel title="Recent complaints" icon={<Headset size={18} />} action={{ label: "View all", to: "/complaints" }}>
          {!x.recentComplaints?.length ? (
            <p className="muted">No complaints yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Complaint</th><th>Customer / location</th><th>Product</th><th>Assigned to</th><th>Status</th></tr></thead>
                <tbody>
                  {x.recentComplaints.map((k: Row) => (
                    <tr key={k.id} className="clickable" onClick={() => navigate(`/complaints/${k.id}`)}>
                      <td className="mono">{k.complaintNo}</td><td>{k.customerName}{k.city ? `, ${k.city}` : ""}</td><td>{words(k.productCategory)} {k.model}</td><td>{k.engineerName ?? "—"}</td><td><StatusBadge status={k.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title={`Today's service assignments (${(x.todaysAssignments ?? []).reduce((s: number, a: Row) => s + a.visits, 0)})`} icon={<CalendarClock size={18} />}>
          {!x.todaysAssignments?.length ? (
            <p className="muted">No visits scheduled for today.</p>
          ) : (
            <ul className="mini-list">
              {x.todaysAssignments.map((a: Row) => (
                <li key={a.engineerId}>
                  <span className="mini-icon" style={{ background: ECO_COLORS.blueBright }}><UserCog size={14} /></span>
                  <div className="mini-main"><div className="cell-title">{a.name}</div></div>
                  <StatusBadge status="assigned" label={`${a.visits} assignment${a.visits === 1 ? "" : "s"}`} />
                  <StatusBadge status={a.completed === a.visits ? "completed" : "in_progress"} label={a.completed === a.visits ? `${a.completed} completed` : `${a.completed} done · ${a.inProgress} on site`} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Quick actions" icon={<Zap size={18} />}>
          <div className="quick-grid">
            <QuickTile tone="blue" icon={<UserCog size={20} />} label="Assign to engineer" onClick={() => navigate("/complaints?status=open")} />
            <QuickTile tone="orange" icon={<RefreshCw size={20} />} label="Pending jobs" onClick={() => navigate("/complaints?status=pending")} />
            <QuickTile tone="green" icon={<CheckCircle2 size={20} />} label="Awaiting OTP" onClick={() => navigate("/complaints?status=resolved")} />
            <QuickTile tone="violet" icon={<FileText size={20} />} label="View reports" onClick={() => navigate("/reports/service")} />
          </div>
          <p className="muted small">Customers raise complaints from the Eco Sor app.</p>
        </Panel>
      </div>
    </>
  );
}
