import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BarChart3, CalendarCheck, CalendarClock, ClipboardList, Clock, FileText, MapPin, PhoneCall, PieChart, Search, ShoppingCart, Store, Trophy, Users, Zap } from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { can } from "../../eco/access";
import { inDate, words } from "../../eco/format";
import { Donut, ECO_COLORS, TrendChart, changePct } from "../../eco/charts";
import { DataTable, StatusBadge, usePaged } from "../../eco/ui";
import { useViewer } from "../../eco/viewer";
import { Kpi, Panel, QuickTile } from "../../eco/widgets";
import { Button, ErrorBox, Spinner } from "../../components/ui";
import { useAsync, useDebounced } from "../../hooks";
import { CallModal, FollowupModal } from "./SalesWork";

const VISIT_COLORS: Record<string, string> = { completed: ECO_COLORS.green, report_submitted: ECO_COLORS.blueBright, checked_in: ECO_COLORS.orange, scheduled: ECO_COLORS.violet, rescheduled: ECO_COLORS.gray, cancelled: ECO_COLORS.red };

/** Sales manager dashboard (design page 6), all figures from GET /dashboard/sales-manager. */
export function SalesManagerHome() {
  const navigate = useNavigate();
  const d = useAsync(() => eco.dashboard("sales-manager"), []);
  const x = d.data;
  if (d.error) return <ErrorBox error={d.error} onRetry={() => d.reload()} />;
  if (!x) return <Spinner />;
  const trend: Row[] = x.trend ?? [];
  const month = trend.at(-1) ?? {};
  const visits = Object.entries((x.visitsLast7Days ?? {}) as Record<string, number>).map(([k, v]) => ({ key: k, value: v, color: VISIT_COLORS[k] ?? ECO_COLORS.gray }));

  return (
    <>
      <div className="kpi-grid">
        <Kpi icon={<Store size={22} />} tone="violet" label="Assigned distributors" value={x.assignedDistributors} to="/distributors" />
        <Kpi icon={<ShoppingCart size={22} />} tone="green" label="Order requests (this month)" value={month.requests ?? 0} delta={changePct(trend, "requests")} to="/purchase-requests" />
        <Kpi icon={<CalendarCheck size={22} />} tone="orange" label="Field visits (this month)" value={month.visits ?? 0} delta={changePct(trend, "visits")} to="/sales/visits" />
        <Kpi icon={<ClipboardList size={22} />} tone="blue" label="Requests to review" value={x.purchaseRequestsToReview} to="/purchase-requests?status=under_review" />
        <Kpi icon={<Clock size={22} />} tone="red" label="Follow-ups overdue" value={x.overdueFollowups} hint={`${x.pendingFollowups} pending`} to="/sales/followups" />
        <Kpi icon={<PhoneCall size={22} />} tone="teal" label="Calls, last 7 days" value={x.callsLast7Days} to="/sales/calls" />
      </div>

      <div className="dash-grid">
        <Panel title="Visit & order trend" icon={<BarChart3 size={18} />}>
          <TrendChart data={trend} bar={{ key: "visits", label: "Field visits" }} line={{ key: "requests", label: "Order requests" }} />
        </Panel>
        <Panel title="Visits by status (7 days)" icon={<PieChart size={18} />}>
          <Donut parts={visits} centerLabel="Visits" empty="No visits in the last week." />
        </Panel>
        <Panel title="Team performance" icon={<Trophy size={18} />} action={{ label: "View all", to: "/sales/team" }}>
          {!x.team?.length ? (
            <p className="muted">No tele-sales or field-sales staff yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Executive</th><th className="num">Visits</th><th className="num">Distrib.</th><th className="num">Overdue</th></tr></thead>
                <tbody>
                  {x.team.slice(0, 6).map((t: Row) => (
                    <tr key={t.employeeId}><td>{t.name}</td><td className="num">{t.visitsLast7Days}</td><td className="num">{t.distributors}</td><td className="num"><StatusBadge status={t.overdueFollowups ? "rejected" : "approved"} label={String(t.overdueFollowups)} /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="dash-grid">
        <Panel title="Recent order requests" icon={<ShoppingCart size={18} />} action={{ label: "View all", to: "/purchase-requests" }}>
          {!x.recentRequests?.length ? (
            <p className="muted">No requests yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>#</th><th>Distributor</th><th>Category</th><th className="num">Qty</th><th>Status</th></tr></thead>
                <tbody>
                  {x.recentRequests.map((r: Row) => (
                    <tr key={r.id} className="clickable" onClick={() => navigate(`/purchase-requests/${r.id}`)}>
                      <td className="mono">{r.requestNo}</td><td>{r.distributorName}</td><td>{words(r.categories ?? "—")}</td><td className="num">{r.units}</td><td><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Upcoming field visits" icon={<MapPin size={18} />} action={{ label: "View schedule", to: "/sales/visits" }}>
          {!x.upcomingVisits?.length ? (
            <p className="muted">Nothing scheduled.</p>
          ) : (
            <ul className="mini-list">
              {x.upcomingVisits.map((v: Row) => (
                <li key={v.id} className="clickable" onClick={() => navigate(`/sales/visits/${v.id}`)}>
                  <span className="mini-icon" style={{ background: ECO_COLORS.blueBright }}><CalendarClock size={15} /></span>
                  <div className="mini-main">
                    <div className="cell-title">{v.distributorName}{v.city ? `, ${v.city}` : ""}</div>
                    <div className="cell-sub">{v.employeeName} · {v.purpose || "Visit"}</div>
                  </div>
                  <span className="mini-side">{inDate(v.visitDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Quick actions" icon={<Zap size={18} />}>
          <div className="quick-grid">
            <QuickTile tone="blue" icon={<Store size={20} />} label="Add distributor" onClick={() => navigate("/distributors?new=1")} />
            <QuickTile tone="green" icon={<ShoppingCart size={20} />} label="Create order request" onClick={() => navigate("/purchase-requests/new")} />
            <QuickTile tone="orange" icon={<CalendarClock size={20} />} label="Schedule field visit" onClick={() => navigate("/sales/visits?new=1")} />
            <QuickTile tone="violet" icon={<FileText size={20} />} label="View reports" onClick={() => navigate("/reports/sales")} />
          </div>
        </Panel>
      </div>
    </>
  );
}

const OUTCOME_COLORS = [ECO_COLORS.green, ECO_COLORS.blueBright, ECO_COLORS.orange, ECO_COLORS.red, ECO_COLORS.violet, ECO_COLORS.gray];

/** Tele-sales / field-sales dashboard (design page 7) with the "my distributors" queue. */
export function MyDistributors() {
  const navigate = useNavigate();
  const viewer = useViewer();
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const [calling, setCalling] = useState<Row | null>(null);
  const [following, setFollowing] = useState<Row | null>(null);
  const d = useAsync(() => eco.dashboard("tele-sales"), []);
  const list = usePaged((page) => eco.distributors({ page, limit: 10, search: term, active: true, sort: "firmName", order: "asc" }), [term]);
  const x = d.data;
  const reqCounts = (x?.myPurchaseRequests ?? {}) as Record<string, number>;

  return (
    <>
      {d.error && <ErrorBox error={d.error} onRetry={() => d.reload()} />}
      {x && (
        <div className="kpi-grid">
          <Kpi icon={<Users size={22} />} tone="blue" label="My distributors" value={x.assignedDistributors} />
          <Kpi icon={<PhoneCall size={22} />} tone="violet" label="Calls made (7 days)" value={x.callsLast7Days} hint={`${x.callsToday} today`} to="/sales/calls" />
          <Kpi icon={<CalendarCheck size={22} />} tone="green" label="Follow-ups due" value={x.followupsDueToday} to="/sales/followups" />
          <Kpi icon={<Clock size={22} />} tone="red" label="Overdue follow-ups" value={x.overdueFollowups} to="/sales/followups" />
          <Kpi icon={<ShoppingCart size={22} />} tone="orange" label="My order requests" value={Object.values(reqCounts).reduce((a, b) => a + b, 0)} to="/purchase-requests" />
          <Kpi icon={<MapPin size={22} />} tone="teal" label="Visits today" value={x.visitsToday} to="/sales/visits" />
        </div>
      )}

      <div className="dash-grid two">
        <Panel title="My distributor queue" icon={<Users size={18} />}>
          <div className="toolbar">
            <div className="search">
              <Search size={16} />
              <input placeholder="Firm, contact, mobile, city…" value={search} onChange={(e) => (setSearch(e.target.value), list.setPage(1))} />
            </div>
          </div>
          <DataTable
            state={list}
            empty="No distributors assigned to you yet"
            columns={[
              { key: "firmName", label: "Distributor", render: (r) => (<><div className="cell-title">{r.firmName}</div><div className="cell-sub">{r.distributorCode}</div></>) },
              { key: "city", label: "Location", render: (r) => [r.city, r.state].filter(Boolean).join(", ") || "—" },
              {
                key: "actions",
                label: "Next action",
                render: (r) => (
                  <div className="row-actions">
                    <a className="btn btn-sm btn-success" href={`tel:${r.mobile}`} onClick={(e) => e.stopPropagation()}><PhoneCall size={14} /> Call</a>
                    {can(viewer, "calls.log") && <Button size="sm" onClick={() => setCalling(r)}>Log call</Button>}
                    {can(viewer, "followups.manage") && <Button size="sm" onClick={() => setFollowing(r)}>Follow-up</Button>}
                    {can(viewer, "purchases.create") && <Button size="sm" className="btn-orange" onClick={() => navigate(`/purchase-requests/new?distributor=${r.id}`)}>Order</Button>}
                  </div>
                ),
              },
            ]}
          />
        </Panel>
        <Panel title={`Today's follow-ups (${x?.todaysFollowups?.length ?? 0})`} icon={<CalendarCheck size={18} />} action={{ label: "View all", to: "/sales/followups" }}>
          {!x ? <Spinner /> : !x.todaysFollowups?.length ? (
            <p className="muted">Nothing due today.</p>
          ) : (
            <ul className="mini-list">
              {x.todaysFollowups.map((f: Row) => (
                <li key={f.id}>
                  <div className="mini-main">
                    <div className="cell-title">{f.distributorName}</div>
                    <div className="cell-sub">{f.notes || words(f.source)}</div>
                  </div>
                  <StatusBadge status={f.dueDate < new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) ? "rejected" : "pending"} label={inDate(f.dueDate)} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="dash-grid">
        <Panel title="My calling performance (7 days)" icon={<PhoneCall size={18} />}>
          <Donut empty="No calls logged this week." centerLabel="Calls" parts={(x?.callOutcomes ?? []).map((o: Row, i: number) => ({ key: o.key, label: o.key, value: o.n, color: OUTCOME_COLORS[i % OUTCOME_COLORS.length] }))} />
        </Panel>
        <Panel title="My order requests" icon={<ShoppingCart size={18} />} action={{ label: "View all", to: "/purchase-requests" }}>
          {!x?.recentRequests?.length ? <p className="muted">None yet.</p> : (
            <ul className="mini-list">
              {x.recentRequests.map((r: Row) => (
                <li key={r.id} className="clickable" onClick={() => navigate(`/purchase-requests/${r.id}`)}>
                  <div className="mini-main"><div className="cell-title mono">{r.requestNo}</div><div className="cell-sub">{r.distributorName}</div></div>
                  <StatusBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Quick actions" icon={<Zap size={18} />}>
          <div className="quick-grid">
            <QuickTile tone="blue" icon={<PhoneCall size={20} />} label="Log a call" onClick={() => navigate("/sales/calls")} />
            <QuickTile tone="green" icon={<ShoppingCart size={20} />} label="Create order request" onClick={() => navigate("/purchase-requests/new")} />
            <QuickTile tone="orange" icon={<CalendarCheck size={20} />} label="Add follow-up" onClick={() => navigate("/sales/followups")} />
            <QuickTile tone="violet" icon={<BarChart3 size={20} />} label="My visits" onClick={() => navigate("/sales/visits")} />
          </div>
        </Panel>
      </div>

      {calling && <CallModal distributor={calling} onClose={() => setCalling(null)} onSaved={() => (setCalling(null), d.reload(true))} />}
      {following && <FollowupModal distributor={following} onClose={() => setFollowing(null)} onSaved={() => (setFollowing(null), d.reload(true))} />}
    </>
  );
}
