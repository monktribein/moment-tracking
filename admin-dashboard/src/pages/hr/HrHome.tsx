import { useNavigate } from "react-router-dom";
import { BarChart3, CalendarCheck, CalendarDays, Clock, Coins, FileClock, PieChart, Receipt, UserCheck, UserPlus, Users, Wallet, Zap } from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { inDate, inr, monthLabel, words } from "../../eco/format";
import { Donut, ECO_COLORS, TrendChart } from "../../eco/charts";
import { StatusBadge } from "../../eco/ui";
import { useViewer } from "../../eco/viewer";
import { Kpi, Panel, QuickTile } from "../../eco/widgets";
import { ErrorBox, Spinner } from "../../components/ui";
import { useAsync } from "../../hooks";

/** HR dashboard (design page 4), all figures from GET /dashboard/hr. */
export function HrHome() {
  const navigate = useNavigate();
  const viewer = useViewer();
  const d = useAsync(() => eco.dashboard("hr"), []);
  const x = d.data;
  if (d.error) return <ErrorBox error={d.error} onRetry={() => d.reload()} />;
  if (!x) return <Spinner />;
  const trend: Row[] = x.trend ?? [];
  const notIn = Math.max(0, x.activeEmployees - x.presentToday - x.onLeaveToday);
  const expenses: Row[] = x.expensesByCategory ?? [];

  return (
    <>
      <div className="kpi-grid">
        <Kpi icon={<Users size={22} />} tone="blue" label="Total employees" value={x.activeEmployees} to="/employees" />
        <Kpi icon={<UserCheck size={22} />} tone="green" label="Present today" value={x.presentToday} to="/hr/attendance" />
        <Kpi icon={<Clock size={22} />} tone="orange" label="On leave today" value={x.onLeaveToday} to="/hr/leaves" />
        <Kpi icon={<CalendarDays size={22} />} tone="violet" label="Leave to approve" value={x.pendingLeaves} to="/hr/leaves" />
        <Kpi icon={<Coins size={22} />} tone="teal" label={`Payroll (${monthLabel(x.payroll?.month ?? "")})`} value={x.payrollTotal ? inr(x.payrollTotal) : "—"} hint={x.payrollTotal ? "net payable" : "not generated yet"} to="/hr/payroll" />
        <Kpi icon={<Receipt size={22} />} tone="green" label="Expenses (MTD, approved)" value={inr(x.expensesApprovedMtd)} hint={`${x.expensesAwaitingApproval} to approve`} to="/hr/expenses" />
      </div>

      <div className="dash-grid">
        <Panel title="Attendance trend" icon={<BarChart3 size={18} />}>
          <TrendChart data={trend} bar={{ key: "presentDays", label: "Present employee-days" }} line={{ key: "avgPresentPerDay", label: "Avg. present per day" }} />
        </Panel>
        <Panel title="Employee status today" icon={<PieChart size={18} />} action={{ label: "View all", to: "/employees" }}>
          <Donut
            centerLabel="Employees"
            center={x.activeEmployees}
            parts={[
              { key: "present", label: "Checked in", value: x.presentToday, color: ECO_COLORS.green },
              { key: "leave", label: "On leave", value: x.onLeaveToday, color: ECO_COLORS.orange },
              { key: "not", label: "Not checked in", value: notIn, color: ECO_COLORS.gray },
            ]}
            empty="No active employees yet."
          />
          {x.inactiveEmployees > 0 && <p className="muted small">{x.inactiveEmployees} inactive account(s) not counted.</p>}
        </Panel>
        <Panel title="Today's attendance" icon={<CalendarCheck size={18} />} action={{ label: "View all", to: "/hr/attendance" }}>
          <ul className="mini-list">
            <li><span className="mini-icon" style={{ background: ECO_COLORS.green }}><UserCheck size={14} /></span><div className="mini-main">Check-in completed</div><b>{x.presentToday}</b></li>
            <li><span className="mini-icon" style={{ background: ECO_COLORS.orange }}><Clock size={14} /></span><div className="mini-main">On leave</div><b>{x.onLeaveToday}</b></li>
            <li><span className="mini-icon" style={{ background: "#94a3b8" }}><Users size={14} /></span><div className="mini-main">Not checked in</div><b>{notIn}</b></li>
          </ul>
        </Panel>
      </div>

      <div className="dash-grid">
        <Panel title="Recent leave requests" icon={<FileClock size={18} />} action={{ label: "View all", to: "/hr/leaves" }}>
          {!x.recentLeaves?.length ? (
            <p className="muted">No leave requests yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Employee</th><th>Type</th><th>From – to</th><th>Status</th></tr></thead>
                <tbody>
                  {x.recentLeaves.map((l: Row) => (
                    <tr key={l.id}><td>{l.employeeName}</td><td>{words(l.leaveType)}</td><td>{l.fromDate === l.toDate ? inDate(l.fromDate) : `${inDate(l.fromDate)} – ${inDate(l.toDate)}`}</td><td><StatusBadge status={l.status} /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Expense claims (this month)" icon={<Receipt size={18} />} action={{ label: "View all", to: "/hr/expenses" }}>
          {!expenses.length ? (
            <p className="muted">No claims this month.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Category</th><th className="num">Claims</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {expenses.map((e) => <tr key={e.category}><td>{e.category}</td><td className="num">{e.claims}</td><td className="num">{inr(e.amount)}</td></tr>)}
                  <tr><td><b>Total</b></td><td className="num"><b>{expenses.reduce((s, e) => s + e.claims, 0)}</b></td><td className="num"><b>{inr(expenses.reduce((s, e) => s + e.amount, 0))}</b></td></tr>
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Quick actions" icon={<Zap size={18} />}>
          <div className="quick-grid">
            {viewer.role === "admin" && <QuickTile tone="blue" icon={<UserPlus size={20} />} label="Add employee" onClick={() => navigate("/employees?new=1")} />}
            <QuickTile tone="green" icon={<CalendarCheck size={20} />} label="Approve leave" onClick={() => navigate("/hr/leaves")} />
            <QuickTile tone="orange" icon={<Receipt size={20} />} label="Approve expenses" onClick={() => navigate("/hr/expenses")} />
            <QuickTile tone="violet" icon={<Wallet size={20} />} label="Process payroll" onClick={() => navigate("/hr/payroll")} />
          </div>
          {x.upcomingHolidays?.length > 0 && (
            <p className="muted small">Next holiday: {x.upcomingHolidays[0].name}, {inDate(x.upcomingHolidays[0].holidayDate)}</p>
          )}
        </Panel>
      </div>
    </>
  );
}
