import { useState, type FormEvent } from "react";
import { Check, PhoneCall, Plus, X } from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { can } from "../../eco/access";
import { inDate, inDateTime, todayIn, words } from "../../eco/format";
import { DataTable, StatusBadge, useAction, usePaged } from "../../eco/ui";
import { useViewer } from "../../eco/viewer";
import { Button, ErrorBox, Field, Modal, PageHeader, Spinner, Tabs, useFeedback } from "../../components/ui";
import { useAsync } from "../../hooks";

// ── Dashboards ─────────────────────────────────────────────────────────────────

export function TeamTable({ team }: { team: Row[] }) {
  return (
    <div className="card">
      <div className="card-head"><h2>Team performance</h2></div>
      {!team?.length ? (
        <p className="muted">No tele-sales or field-sales employees yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Executive</th><th className="num">Distributors</th><th className="num">Visits (7 days)</th><th className="num">Overdue follow-ups</th></tr></thead>
            <tbody>
              {team.map((t) => (
                <tr key={t.employeeId}><td>{t.name}</td><td className="num">{t.distributors}</td><td className="num">{t.visitsLast7Days}</td><td className={`num${t.overdueFollowups ? " danger-text" : ""}`}>{t.overdueFollowups}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The team table on its own page. */
export function TeamPage() {
  const d = useAsync(() => eco.dashboard("sales-manager"), []);
  return (
    <>
      <PageHeader title="Team performance" subtitle="Distributors, visits and follow-up discipline per executive." />
      {d.error ? <ErrorBox error={d.error} /> : !d.data ? <Spinner /> : <TeamTable team={d.data.team} />}
    </>
  );
}

// ── Follow-ups ──────────────────────────────────────────────────────────────────

export function Followups() {
  const viewer = useViewer();
  const [tab, setTab] = useState<"due" | "pending" | "done" | "cancelled">("due");
  const [creating, setCreating] = useState(false);
  const { confirm } = useFeedback();
  const { run } = useAction();
  const list = usePaged(
    (page) => eco.followups({ page, limit: 20, ...(tab === "due" ? { status: "pending", to: todayIn() } : { status: tab }), sort: "dueDate", order: tab === "done" ? "desc" : "asc" }),
    [tab],
  );
  const act = async (r: Row, action: "complete" | "cancel") => {
    if (action === "cancel" && !(await confirm({ title: "Cancel this follow-up?", message: r.distributorName, confirmLabel: "Cancel follow-up", danger: true }))) return;
    if (await run(() => eco.followupAction(r.id, action), action === "complete" ? "Follow-up done" : "Follow-up cancelled")) list.reload(true);
  };
  return (
    <>
      <PageHeader
        title="Follow-ups"
        subtitle={can(viewer, "visits.assign") ? "Your team's follow-ups. Overdue ones first." : "Your follow-ups. Overdue ones first."}
        actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>New follow-up</Button>}
      />
      <div className="card">
        <div className="toolbar">
          <Tabs value={tab} onChange={(t) => (setTab(t), list.setPage(1))} items={[{ value: "due", label: "Due & overdue" }, { value: "pending", label: "All pending" }, { value: "done", label: "Done" }, { value: "cancelled", label: "Cancelled" }]} />
        </div>
        <DataTable
          state={list}
          empty={tab === "due" ? "Nothing due. Well done." : "No follow-ups"}
          columns={[
            { key: "dueDate", label: "Due", render: (r) => <span className={r.status === "pending" && r.dueDate < todayIn() ? "danger-text" : ""}>{inDate(r.dueDate)}</span> },
            { key: "distributorName", label: "Distributor" },
            { key: "employeeName", label: "Employee" },
            { key: "source", label: "From", render: (r) => words(r.source) },
            { key: "notes", label: "Notes", render: (r) => r.notes || "—" },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
            {
              key: "actions",
              label: "",
              render: (r) =>
                r.status === "pending" && (
                  <div className="row-actions">
                    <Button size="sm" variant="success" icon={<Check size={14} />} onClick={() => act(r, "complete")}>Done</Button>
                    <Button size="sm" variant="ghost" icon={<X size={14} />} aria-label="Cancel" onClick={() => act(r, "cancel")} />
                  </div>
                ),
            },
          ]}
        />
      </div>
      {creating && <FollowupModal onClose={() => setCreating(false)} onSaved={() => (setCreating(false), list.reload(true))} />}
    </>
  );
}

function DistributorPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const d = useAsync(() => eco.distributors({ limit: 100, active: true, sort: "firmName", order: "asc" }), []);
  return (
    <Field label="Distributor" required>
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {(d.data?.items ?? []).map((x) => <option key={x.id} value={x.id}>{x.firmName}</option>)}
        </select>
      )}
    </Field>
  );
}

export function FollowupModal({ distributor, onClose, onSaved }: { distributor?: Row; onClose: () => void; onSaved: () => void }) {
  const [distributorId, setDistributorId] = useState(distributor?.id ?? "");
  const [dueDate, setDueDate] = useState(todayIn());
  const [notes, setNotes] = useState("");
  const [source, setSource] = useState<"call" | "visit">("call");
  const calls = useAsync(() => (distributorId ? eco.calls({ distributorId, limit: 5 }) : Promise.resolve(null)), [distributorId]);
  const visits = useAsync(() => (distributorId ? eco.visits({ distributorId, limit: 5 }) : Promise.resolve(null)), [distributorId]);
  const [linkId, setLinkId] = useState("");
  const { busy, run } = useAction();
  const options = (source === "call" ? calls.data?.items : visits.data?.items) ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const link = linkId || options[0]?.id;
    await run(async () => {
      await eco.createFollowup({ distributorId, dueDate, source, ...(source === "call" ? { callLogId: link } : { visitId: link }), ...(notes.trim() ? { notes: notes.trim() } : {}) });
      onSaved();
    }, "Follow-up added");
  };

  return (
    <Modal title={distributor ? `Follow-up · ${distributor.firmName}` : "New follow-up"} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="followup-form" busy={busy} disabled={!distributorId || !options.length}>Save</Button></>}>
      <form id="followup-form" className="form" onSubmit={submit}>
        {!distributor && <DistributorPicker value={distributorId} onChange={(v) => (setDistributorId(v), setLinkId(""))} />}
        <div className="grid-2">
          <Field label="Follows up on" required>
            {(id) => (
              <select id={id} value={source} onChange={(e) => (setSource(e.target.value as "call" | "visit"), setLinkId(""))}>
                <option value="call">A call</option>
                <option value="visit">A visit</option>
              </select>
            )}
          </Field>
          <Field label={source === "call" ? "Call" : "Visit"} required hint={distributorId && !options.length ? `No ${source} with this distributor yet. Log one first.` : undefined}>
            {(id) => (
              <select id={id} value={linkId} onChange={(e) => setLinkId(e.target.value)} disabled={!options.length}>
                {options.map((o) => <option key={o.id} value={o.id}>{source === "call" ? `${inDateTime(o.calledAt)} · ${o.outcome ?? words(o.direction)}` : `${inDate(o.visitDate)} · ${words(o.status)}`}</option>)}
              </select>
            )}
          </Field>
        </div>
        <Field label="Due date" required>{(id) => <input id={id} type="date" min={todayIn()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
        <Field label="Notes">{(id) => <textarea id={id} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      </form>
    </Modal>
  );
}

// ── Call log ────────────────────────────────────────────────────────────────────

export function CallLogs() {
  const [creating, setCreating] = useState(false);
  const [direction, setDirection] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const list = usePaged((page) => eco.calls({ page, limit: 20, direction, from, to }), [direction, from, to]);
  return (
    <>
      <PageHeader title="Call log" subtitle="Incoming and outgoing distributor calls. No recordings." actions={<Button variant="primary" icon={<PhoneCall size={16} />} onClick={() => setCreating(true)}>Log a call</Button>} />
      <div className="card">
        <div className="toolbar">
          <div className="filters">
            <select value={direction} onChange={(e) => (setDirection(e.target.value), list.setPage(1))} aria-label="Direction">
              <option value="">In and out</option>
              <option value="in">Incoming</option>
              <option value="out">Outgoing</option>
            </select>
            <input type="date" aria-label="From" value={from} onChange={(e) => (setFrom(e.target.value), list.setPage(1))} />
            <input type="date" aria-label="To" value={to} onChange={(e) => (setTo(e.target.value), list.setPage(1))} />
          </div>
        </div>
        <DataTable
          state={list}
          empty="No calls logged"
          columns={[
            { key: "calledAt", label: "When", render: (r) => inDateTime(r.calledAt) },
            { key: "distributorName", label: "Distributor" },
            { key: "employeeName", label: "Employee" },
            { key: "direction", label: "Direction", render: (r) => (r.direction === "in" ? "Incoming" : "Outgoing") },
            { key: "outcome", label: "Outcome", render: (r) => r.outcome || "—" },
            { key: "notes", label: "Notes", render: (r) => r.notes || "—" },
            { key: "nextFollowupDate", label: "Next follow-up", render: (r) => inDate(r.nextFollowupDate) },
          ]}
        />
      </div>
      {creating && <CallModal onClose={() => setCreating(false)} onSaved={() => (setCreating(false), list.reload(true))} />}
    </>
  );
}

export function CallModal({ distributor, onClose, onSaved }: { distributor?: Row; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ distributorId: distributor?.id ?? "", direction: "out", outcome: "", notes: "", nextFollowupDate: "" });
  const { busy, run } = useAction();
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()));
    await run(async () => (await eco.createCall(body), onSaved()), "Call logged");
  };
  return (
    <Modal title={distributor ? `Call · ${distributor.firmName}` : "Log a call"} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="call-form" busy={busy} disabled={!f.distributorId}>Save</Button></>}>
      <form id="call-form" className="form" onSubmit={submit}>
        {!distributor && <DistributorPicker value={f.distributorId} onChange={(v) => set("distributorId", v)} />}
        <div className="grid-2">
          <Field label="Direction" required>
            {(id) => (
              <select id={id} value={f.direction} onChange={(e) => set("direction", e.target.value)}>
                <option value="out">Outgoing</option>
                <option value="in">Incoming</option>
              </select>
            )}
          </Field>
          <Field label="Outcome">
            {(id) => (
              <select id={id} value={f.outcome} onChange={(e) => set("outcome", e.target.value)}>
                <option value="">—</option>
                {["Interested", "Order expected", "Call back later", "Not reachable", "Not interested", "Complaint"].map((o) => <option key={o}>{o}</option>)}
              </select>
            )}
          </Field>
        </div>
        <Field label="Discussion notes">{(id) => <textarea id={id} rows={3} maxLength={2000} value={f.notes} onChange={(e) => set("notes", e.target.value)} />}</Field>
        <Field label="Next follow-up" hint="Creates a follow-up for you on that day.">{(id) => <input id={id} type="date" min={todayIn()} value={f.nextFollowupDate} onChange={(e) => set("nextFollowupDate", e.target.value)} />}</Field>
      </form>
    </Modal>
  );
}
