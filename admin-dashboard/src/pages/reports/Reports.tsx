import { useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { Download } from "lucide-react";
import { eco } from "../../eco/api";
import { can } from "../../eco/access";
import { inDate, inDateTime, inr, words } from "../../eco/format";
import { DataTable, StatusBadge, usePaged } from "../../eco/ui";
import { useViewer } from "../../eco/viewer";
import { Button, PageHeader, Tabs, useFeedback } from "../../components/ui";
import { useAsync } from "../../hooks";
import { REPORT_KINDS } from "../../eco/reportKinds";

type Kind = "sales" | "purchases" | "service" | "hr";

const SECTIONS: Record<Kind, { value: string; label: string; statuses?: string[] }[]> = {
  sales: [
    { value: "visits", label: "Visits", statuses: ["scheduled", "checked_in", "report_submitted", "completed", "cancelled", "rescheduled"] },
    { value: "calls", label: "Call logs" },
    { value: "followups", label: "Follow-ups", statuses: ["pending", "done", "cancelled"] },
    { value: "distributors", label: "Distributor master" },
  ],
  purchases: [
    { value: "requests", label: "Requests", statuses: ["draft", "submitted", "under_review", "correction_required", "approved", "processed", "rejected", "cancelled"] },
    { value: "payments", label: "Payment verification", statuses: ["pending", "verified", "rejected"] },
  ],
  service: [
    { value: "complaints", label: "Complaints", statuses: ["open", "assigned", "in_progress", "pending", "resolved", "closed", "reopened"] },
    { value: "engineers", label: "Engineer performance" },
  ],
  hr: [
    { value: "attendance", label: "Attendance", statuses: ["checked_in", "checked_out", "present", "half_day", "absent"] },
    { value: "expenses", label: "Expenses", statuses: ["submitted", "approved", "rejected", "reimbursed"] },
    { value: "leaves", label: "Leave", statuses: ["pending", "approved", "rejected", "cancelled"] },
    { value: "payroll", label: "Payroll", statuses: ["draft", "approved", "finalized"] },
  ],
};


const MONEY = /amount|salary|netPayable|adjustments/i;
const DATE_ONLY = /^(visitDate|dueDate|expenseDate|fromDate|toDate|paymentDate|date|nextFollowupDate)$/;
const DATE_TIME = /(At|Time)$/;

const cell = (key: string, v: unknown) => {
  if (v === null || v === undefined || v === "") return "—";
  if (key === "status" || key === "paymentStatus") return <StatusBadge status={v} />;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (MONEY.test(key) && typeof v === "number") return inr(v);
  if (DATE_ONLY.test(key)) return inDate(v);
  if (DATE_TIME.test(key)) return inDateTime(v);
  return String(v);
};

/** Sales, purchases, service and HR reports: filter, preview page by page, export CSV. */
export default function Reports() {
  const { kind = "sales" } = useParams();
  const k = (kind in SECTIONS ? kind : "sales") as Kind;
  const viewer = useViewer();
  const { toast } = useFeedback();
  const [section, setSection] = useState(SECTIONS[k][0].value);
  const current = SECTIONS[k].find((s) => s.value === section) ?? SECTIONS[k][0];
  const [f, setF] = useState({ from: "", to: "", status: "", employeeId: "", distributorId: "" });
  const [exporting, setExporting] = useState(false);
  const employees = useAsync(() => eco.employees({ limit: 100, sort: "name", order: "asc" }).catch(() => ({ items: [], meta: { page: 1, limit: 0, total: 0, pages: 1 } })), []);
  const distributors = useAsync(() => (["sales", "purchases"].includes(k) ? eco.distributors({ limit: 100, sort: "firmName", order: "asc" }).catch(() => null) : Promise.resolve(null)), [k]);
  const query = { section: current.value, ...f };
  const list = usePaged((page) => eco.report(k, { ...query, page, limit: 25 }), [k, current.value, f.from, f.to, f.status, f.employeeId, f.distributorId]);
  const columns = ((list.data?.columns as string[]) ?? []).map((c) => ({ key: c, label: words(c.replace(/([A-Z])/g, " $1").toLowerCase()), render: (r: Record<string, unknown>) => cell(c, r[c]) }));
  const set = (key: keyof typeof f, v: string) => (setF((x) => ({ ...x, [key]: v })), list.setPage(1));

  const exportCsv = async () => {
    setExporting(true);
    try {
      await eco.reportCsv(k, query);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title={`${REPORT_KINDS.find((r) => r.kind === k)?.label} reports`}
        subtitle="Operational reports, not audited financial statements."
        actions={can(viewer, "reports.export") && <Button variant="primary" icon={<Download size={16} />} busy={exporting} onClick={exportCsv}>Export CSV</Button>}
      />
      <div className="tabs" style={{ marginBottom: 14 }}>
        {REPORT_KINDS.filter((r) => viewer.role === "admin" || r.role === viewer.role).map((r) => (
          <NavLink key={r.kind} to={`/reports/${r.kind}`} className={({ isActive }) => `tab${isActive ? " active" : ""}`} onClick={() => (setSection(SECTIONS[r.kind][0].value), setF({ from: "", to: "", status: "", employeeId: "", distributorId: "" }))}>
            {r.label}
          </NavLink>
        ))}
      </div>
      <div className="card">
        <div className="toolbar">
          <Tabs value={current.value} onChange={(s) => (setSection(s), setF((x) => ({ ...x, status: "" })), list.setPage(1))} items={SECTIONS[k].map((s) => ({ value: s.value, label: s.label }))} />
          <div className="filters">
            <input type="date" aria-label="From" value={f.from} onChange={(e) => set("from", e.target.value)} />
            <input type="date" aria-label="To" value={f.to} onChange={(e) => set("to", e.target.value)} />
            {current.statuses && (
              <select value={f.status} onChange={(e) => set("status", e.target.value)} aria-label="Status">
                <option value="">All statuses</option>
                {current.statuses.map((s) => <option key={s} value={s}>{words(s)}</option>)}
              </select>
            )}
            {current.value !== "distributors" && current.value !== "payments" && (
              <select value={f.employeeId} onChange={(e) => set("employeeId", e.target.value)} aria-label="Employee">
                <option value="">All employees</option>
                {(employees.data?.items ?? []).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            )}
            {distributors.data && (
              <select value={f.distributorId} onChange={(e) => set("distributorId", e.target.value)} aria-label="Distributor">
                <option value="">All distributors</option>
                {distributors.data.items.map((d) => <option key={d.id} value={d.id}>{d.firmName}</option>)}
              </select>
            )}
          </div>
        </div>
        <DataTable state={list} columns={columns} empty="No rows for these filters" rowKey={(_, i) => String(i)} />
      </div>
    </>
  );
}
