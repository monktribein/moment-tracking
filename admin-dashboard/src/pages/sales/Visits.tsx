import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { can } from "../../eco/access";
import { inDate, todayIn, words } from "../../eco/format";
import { DataTable, StatusBadge, useAction, usePaged } from "../../eco/ui";
import { useViewer } from "../../eco/viewer";
import { MonthCalendar } from "../../eco/widgets";
import { Button, ErrorBox, Field, Modal, PageHeader, Spinner, Tabs } from "../../components/ui";
import { useAsync, useDebounced } from "../../hooks";

const STATUSES = ["scheduled", "checked_in", "report_submitted", "completed", "cancelled", "rescheduled"];

export default function Visits() {
  const viewer = useViewer();
  const navigate = useNavigate();
  const assign = can(viewer, "visits.assign");
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<"list" | "calendar">("list");
  const [status, setStatus] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState(todayIn().slice(0, 7));
  const [creating, setCreating] = useState(Boolean(params.get("new")) && assign);
  const term = useDebounced(search.trim());
  const team = useAsync(() => (assign ? eco.employees({ limit: 100, active: true, sort: "name", order: "asc" }) : Promise.resolve(null)), [assign]);
  const sales = (team.data?.items ?? []).filter((e) => ["field_sales", "tele_sales", "sales_manager"].includes(e.role));
  const list = usePaged((page) => eco.visits({ page, limit: 20, status, employeeId, search: term, sort: "visitDate" }), [status, employeeId, term]);
  const cal = useAsync(() => (view === "calendar" ? eco.visits({ limit: 100, from: `${month}-01`, to: `${month}-31`, employeeId, sort: "visitDate", order: "asc" }) : Promise.resolve(null)), [view, month, employeeId]);

  return (
    <>
      <PageHeader
        title="Visits"
        subtitle={assign ? "Assign distributor visits and follow them from check-in to completion." : "Your assigned distributor visits."}
        actions={assign && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>Assign visit</Button>}
      />
      <div className="card">
        <div className="toolbar">
          <Tabs<"list" | "calendar"> value={view} onChange={setView} items={[{ value: "list", label: "List" }, { value: "calendar", label: "Calendar" }]} />
          <div className="filters">
            {view === "list" && (
              <>
                <div className="search">
                  <Search size={16} />
                  <input placeholder="Distributor, employee, purpose…" value={search} onChange={(e) => (setSearch(e.target.value), list.setPage(1))} />
                </div>
                <select value={status} onChange={(e) => (setStatus(e.target.value), list.setPage(1))} aria-label="Status">
                  <option value="">All statuses</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{words(s)}</option>)}
                </select>
              </>
            )}
            {assign && (
              <select value={employeeId} onChange={(e) => (setEmployeeId(e.target.value), list.setPage(1))} aria-label="Employee">
                <option value="">Whole team</option>
                {sales.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            )}
          </div>
        </div>
        {view === "list" ? (
          <DataTable
            state={list}
            empty="No visits"
            onRow={(r) => navigate(`/sales/visits/${r.id}`)}
            columns={[
              { key: "visitDate", label: "Date", render: (r) => inDate(r.visitDate) },
              { key: "distributorName", label: "Distributor" },
              { key: "employeeName", label: "Employee" },
              { key: "purpose", label: "Purpose", render: (r) => r.purpose || "—" },
              { key: "priority", label: "Priority", render: (r) => <StatusBadge status={r.priority === "urgent" || r.priority === "high" ? "open" : "draft"} label={words(r.priority)} /> },
              { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        ) : cal.error ? (
          <ErrorBox error={cal.error} />
        ) : !cal.data ? (
          <Spinner />
        ) : (
          <MonthCalendar
            month={month}
            onMonth={setMonth}
            events={cal.data.items.map((v: Row) => ({ date: v.visitDate, label: `${v.distributorName} · ${v.employeeName}`, onClick: () => navigate(`/sales/visits/${v.id}`) }))}
          />
        )}
      </div>
      {creating && <AssignVisitModal team={sales} onClose={() => (setCreating(false), params.get("new") && setParams({}, { replace: true }))} onSaved={(v) => (setCreating(false), list.reload(true), cal.reload(true), navigate(`/sales/visits/${v.id}`))} />}
    </>
  );
}

export function AssignVisitModal({ team, distributorId, onClose, onSaved }: { team: Row[]; distributorId?: string; onClose: () => void; onSaved: (v: Row) => void }) {
  const distributors = useAsync(() => eco.distributors({ limit: 100, active: true, sort: "firmName", order: "asc" }), []);
  const [f, setF] = useState({ distributorId: distributorId ?? "", employeeId: "", visitDate: todayIn(), purpose: "", priority: "normal", instructions: "" });
  const [error, setError] = useState("");
  const { busy, run } = useAction();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!f.distributorId || !f.employeeId) return setError("Choose the distributor and the employee.");
    if (f.visitDate < todayIn()) return setError("The visit date cannot be in the past.");
    await run(async () => onSaved(await eco.createVisit({ ...f, purpose: f.purpose.trim() || undefined, instructions: f.instructions.trim() || undefined })), "Visit assigned");
  };

  return (
    <Modal title="Assign visit" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="visit-form" busy={busy}>Assign</Button></>}>
      <form id="visit-form" className="form" onSubmit={submit}>
        <Field label="Distributor" required>
          {(id) => (
            <select id={id} value={f.distributorId} onChange={(e) => set("distributorId", e.target.value)}>
              <option value="">Choose…</option>
              {(distributors.data?.items ?? []).map((d) => <option key={d.id} value={d.id}>{d.firmName} {d.city ? `· ${d.city}` : ""}</option>)}
            </select>
          )}
        </Field>
        <Field label="Employee" required>
          {(id) => (
            <select id={id} value={f.employeeId} onChange={(e) => set("employeeId", e.target.value)}>
              <option value="">Choose…</option>
              {team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </Field>
        <div className="grid-2">
          <Field label="Date" required>{(id) => <input id={id} type="date" min={todayIn()} value={f.visitDate} onChange={(e) => set("visitDate", e.target.value)} />}</Field>
          <Field label="Priority">
            {(id) => (
              <select id={id} value={f.priority} onChange={(e) => set("priority", e.target.value)}>
                {["low", "normal", "high", "urgent"].map((p) => <option key={p} value={p}>{words(p)}</option>)}
              </select>
            )}
          </Field>
        </div>
        <Field label="Purpose">{(id) => <input id={id} maxLength={300} value={f.purpose} onChange={(e) => set("purpose", e.target.value)} />}</Field>
        <Field label="Instructions">{(id) => <textarea id={id} rows={2} maxLength={1000} value={f.instructions} onChange={(e) => set("instructions", e.target.value)} />}</Field>
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  );
}
