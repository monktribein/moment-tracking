import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  CalendarClock,
  ClipboardCheck,
  CreditCard,
  FileText,
  Headset,
  PieChart,
  ShoppingCart,
  Store,
  TriangleAlert,
  Trophy,
  UserCheck,
  UserPlus,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { inDate, inDateTime, words } from "../../eco/format";
import { CategoryBars, Donut, ECO_COLORS, TrendChart, changePct } from "../../eco/charts";
import { Kpi, Panel, QuickTile, sumOf } from "../../eco/widgets";
import { ErrorBox, Spinner } from "../../components/ui";
import { useAsync } from "../../hooks";

const OPEN_COMPLAINTS = ["open", "assigned", "in_progress", "pending", "reopened"];

const activityIcon = (action: string): { color: string; icon: ReactElement } => {
  if (action.startsWith("complaint")) return { color: ECO_COLORS.green, icon: <Wrench size={15} /> };
  if (action.startsWith("purchase") || action.startsWith("payment")) return { color: ECO_COLORS.blueBright, icon: <ShoppingCart size={15} /> };
  if (action.startsWith("distributor")) return { color: ECO_COLORS.violet, icon: <Store size={15} /> };
  if (action.startsWith("visit")) return { color: ECO_COLORS.orange, icon: <CalendarClock size={15} /> };
  return { color: "#64748b", icon: <Activity size={15} /> };
};

/** Admin dashboard (design page 2): every figure comes from GET /api/v1/dashboard/admin and the audit log. */
export default function EcoDashboard() {
  const navigate = useNavigate();
  const d = useAsync(() => eco.dashboard("admin"), []);
  const recent = useAsync(() => eco.auditLogs({ limit: 6 }), []);
  const x = d.data;

  if (d.error) return <ErrorBox error={d.error} onRetry={() => d.reload()} />;
  if (!x) return <Spinner />;

  const trend: Row[] = x.trend ?? [];
  const thisMonth = trend.at(-1) ?? {};
  const c = x.complaints ?? {};
  const resolved = (c.resolved ?? 0) + (c.closed ?? 0);
  const inProgress = (c.assigned ?? 0) + (c.in_progress ?? 0);
  const pending = (c.open ?? 0) + (c.pending ?? 0) + (c.reopened ?? 0);
  const allComplaints = resolved + inProgress + pending;
  const top: Row[] = x.topDistributors ?? [];
  const topMax = Math.max(1, ...top.map((t) => t.units));

  return (
    <>
      <div className="kpi-grid">
        <Kpi icon={<Users size={22} />} tone="blue" label="Total customers" value={x.customers} delta={changePct(trend, "customers")} hint={`${thisMonth.customers ?? 0} new this month`} />
        <Kpi icon={<Store size={22} />} tone="violet" label="Distributors" value={x.distributors} hint={`${thisMonth.distributors ?? 0} added this month`} to="/distributors" />
        <Kpi icon={<ShoppingCart size={22} />} tone="green" label="Order requests (this month)" value={thisMonth.requests ?? 0} delta={changePct(trend, "requests")} to="/purchase-requests" />
        <Kpi icon={<TriangleAlert size={22} />} tone="orange" label="Open complaints" value={sumOf(c, OPEN_COMPLAINTS)} delta={changePct(trend, "complaints")} goodWhenDown hint="change = complaints received" to="/complaints" />
        <Kpi icon={<CreditCard size={22} />} tone="teal" label="Payments to verify" value={x.paymentsAwaitingVerification} to="/payments" />
        <Kpi icon={<UserCheck size={22} />} tone="violet" label="Present today" value={x.presentToday} hint={`of ${x.employees} employees`} to="/hr/attendance" />
      </div>

      <div className="dash-grid">
        <Panel title="Business growth overview" icon={<BarChart3 size={18} />}>
          <TrendChart data={trend} bar={{ key: "requests", label: "Order requests" }} line={{ key: "customers", label: "New customers" }} />
        </Panel>
        <Panel title="Service summary" icon={<PieChart size={18} />} action={{ label: "View all", to: "/complaints" }}>
          <Donut
            empty="No complaints yet."
            center={allComplaints ? `${Math.round((resolved / allComplaints) * 100)}%` : "0%"}
            centerLabel="Service resolved"
            parts={[
              { key: "resolved", label: "Resolved", value: resolved, color: ECO_COLORS.green },
              { key: "progress", label: "In progress", value: inProgress, color: ECO_COLORS.orange },
              { key: "pending", label: "Pending", value: pending, color: ECO_COLORS.gray },
            ]}
          />
        </Panel>
        <Panel title="Recent activities" icon={<Activity size={18} />} action={{ label: "View all", to: "/audit-logs" }}>
          {recent.error ? (
            <ErrorBox error={recent.error} />
          ) : !recent.data ? (
            <Spinner />
          ) : !recent.data.items.length ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <ul className="mini-list">
              {recent.data.items.map((a) => {
                const ic = activityIcon(String(a.action));
                return (
                  <li key={a.id}>
                    <span className="mini-icon" style={{ background: ic.color }}>{ic.icon}</span>
                    <div className="mini-main">
                      <div className="cell-title">{words(String(a.action).replace(/\./g, " "))}</div>
                      <div className="cell-sub">by {a.actorName ?? words(a.actorRole) ?? "System"}</div>
                    </div>
                    <span className="mini-side">{inDateTime(a.at).split(",").pop()}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="dash-grid">
        <Panel title="Top distributors" icon={<Trophy size={18} />} action={{ label: "View all", to: "/distributors" }}>
          {!top.length ? (
            <p className="muted">No approved orders yet.</p>
          ) : (
            <ul className="mini-list">
              {top.map((t, i) => (
                <li key={t.id}>
                  <span className="rank">{i + 1}</span>
                  <div className="mini-main">
                    <div className="between">
                      <span className="cell-title">{t.firmName}</span>
                      <b>{t.units} units</b>
                    </div>
                    <div className="rank-bar"><span style={{ width: `${(t.units / topMax) * 100}%`, background: [ECO_COLORS.green, ECO_COLORS.blueBright, ECO_COLORS.violet, ECO_COLORS.orange, ECO_COLORS.teal][i] }} /></div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">Units on approved and processed requests (prices are agreed outside the platform).</p>
        </Panel>
        <Panel title="Complaints by category" icon={<Headset size={18} />} action={{ label: "View all", to: "/complaints" }}>
          <CategoryBars items={(x.complaintsByCategory ?? []).map((k: Row) => ({ key: k.key, label: words(String(k.key).replace(/^(inverter|battery)_/, "")), value: k.n }))} />
        </Panel>
        <Panel title="Quick actions" icon={<Zap size={18} />}>
          <div className="quick-grid">
            <QuickTile tone="blue" icon={<UserPlus size={20} />} label="Add employee" onClick={() => navigate("/employees?new=1")} />
            <QuickTile tone="green" icon={<Store size={20} />} label="Add distributor" onClick={() => navigate("/distributors?new=1")} />
            <QuickTile tone="violet" icon={<ShoppingCart size={20} />} label="Create order request" onClick={() => navigate("/purchase-requests/new")} />
            <QuickTile tone="orange" icon={<CalendarClock size={20} />} label="Schedule field visit" onClick={() => navigate("/sales/visits?new=1")} />
            <QuickTile tone="teal" icon={<ClipboardCheck size={20} />} label="Verify payments" onClick={() => navigate("/payments")} />
            <QuickTile tone="blue" icon={<FileText size={20} />} label="View reports" onClick={() => navigate("/reports/sales")} />
          </div>
        </Panel>
      </div>

      <Panel title="Upcoming field visits" icon={<CalendarClock size={18} />} action={{ label: "View schedule", to: "/sales/visits" }}>
        {!x.upcomingVisits?.length ? (
          <p className="muted">No visits scheduled.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Executive</th><th>Distributor / location</th><th>Purpose</th></tr></thead>
              <tbody>
                {x.upcomingVisits.map((v: Row) => (
                  <tr key={v.id} className="clickable" onClick={() => navigate(`/sales/visits/${v.id}`)}>
                    <td>{inDate(v.visitDate)}</td><td>{v.employeeName}</td><td>{v.distributorName}{v.city ? `, ${v.city}` : ""}</td><td>{v.purpose || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
