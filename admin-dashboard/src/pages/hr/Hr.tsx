import { useMemo, useState, type FormEvent } from "react";
import { Check, Download, Lock, Pencil, Plus, Trash2, Wallet, X } from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { inDate, inDateTime, inr, monthLabel, todayIn, words } from "../../eco/format";
import { DataTable, ReasonModal, StatusBadge, useAction, usePaged } from "../../eco/ui";
import { MonthCalendar, type CalEvent } from "../../eco/widgets";
import { Button, ErrorBox, Field, Modal, PageHeader, Spinner, Tabs, useFeedback } from "../../components/ui";
import { useAsync } from "../../hooks";
import { fmtDuration } from "../../format";

// ── Dashboard ───────────────────────────────────────────────────────────────────

// ── Attendance ──────────────────────────────────────────────────────────────────

export function HrAttendance() {
  const [from, setFrom] = useState(todayIn());
  const [to, setTo] = useState(todayIn());
  const [search, setSearch] = useState("");
  const [correcting, setCorrecting] = useState<Row | null>(null);
  const list = usePaged((page) => eco.attendance({ page, limit: 25, from, to, search: search.trim(), sort: "date" }), [from, to, search]);
  return (
    <>
      <PageHeader title="Attendance" subtitle="Daily check-in and check-out of every employee. Corrections need a reason and are audited." />
      <div className="card">
        <div className="toolbar">
          <div className="filters">
            <input type="date" aria-label="From" value={from} onChange={(e) => (setFrom(e.target.value), list.setPage(1))} />
            <input type="date" aria-label="To" value={to} onChange={(e) => (setTo(e.target.value), list.setPage(1))} />
            <input placeholder="Name or employee code" value={search} onChange={(e) => (setSearch(e.target.value), list.setPage(1))} />
          </div>
        </div>
        <DataTable
          state={list}
          empty="No attendance in this range"
          columns={[
            { key: "date", label: "Date", render: (r) => inDate(r.date) },
            { key: "agentName", label: "Employee", render: (r) => (<><div>{r.agentName}</div><div className="cell-sub">{r.employeeCode ?? ""}</div></>) },
            { key: "in", label: "Check-in", render: (r) => (r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—") },
            { key: "out", label: "Check-out", render: (r) => (r.checkOutTime ? new Date(r.checkOutTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—") },
            { key: "minutes", label: "Worked", render: (r) => (r.totalWorkingMinutes ? fmtDuration(r.totalWorkingMinutes) : "—") },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
            { key: "notes", label: "Notes", render: (r) => r.notes || "—" },
            { key: "actions", label: "", render: (r) => <Button size="sm" icon={<Pencil size={14} />} onClick={() => setCorrecting(r)}>Correct</Button> },
          ]}
        />
      </div>
      {correcting && <CorrectionModal row={correcting} onClose={() => setCorrecting(null)} onSaved={() => (setCorrecting(null), list.reload(true))} />}
    </>
  );
}

const toLocalInput = (v: unknown): string => {
  if (!v) return "";
  const d = new Date(v as string);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function CorrectionModal({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const [checkIn, setCheckIn] = useState(toLocalInput(row.checkInTime));
  const [checkOut, setCheckOut] = useState(toLocalInput(row.checkOutTime));
  const [status, setStatus] = useState<string>(row.status ?? "present");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const { busy, run } = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return setError("A reason is required.");
    if (checkIn && checkOut && checkOut < checkIn) return setError("Check-out cannot be before check-in.");
    await run(
      async () => (await eco.correctAttendance({ attendanceId: row.id, status, reason: reason.trim(), ...(checkIn ? { checkInTime: new Date(checkIn).toISOString() } : {}), ...(checkOut ? { checkOutTime: new Date(checkOut).toISOString() } : {}) }), onSaved()),
      "Attendance corrected",
    );
  };
  return (
    <Modal title={`Correct ${row.agentName} · ${inDate(row.date)}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="correct-form" busy={busy}>Save correction</Button></>}>
      <form id="correct-form" className="form" onSubmit={submit}>
        <div className="grid-2">
          <Field label="Check-in">{(id) => <input id={id} type="datetime-local" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />}</Field>
          <Field label="Check-out">{(id) => <input id={id} type="datetime-local" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />}</Field>
        </div>
        <Field label="Status">
          {(id) => (
            <select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
              {["present", "half_day", "absent", "checked_in", "checked_out"].map((s) => <option key={s} value={s}>{words(s)}</option>)}
            </select>
          )}
        </Field>
        <Field label="Reason" required hint="Saved with the old and new values in the audit log.">{(id) => <textarea id={id} rows={2} maxLength={500} value={reason} onChange={(e) => (setReason(e.target.value), setError(""))} />}</Field>
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  );
}

// ── Expenses ────────────────────────────────────────────────────────────────────

export function Expenses() {
  const [tab, setTab] = useState<"submitted" | "approved" | "reimbursed" | "rejected">("submitted");
  const [dialog, setDialog] = useState<{ row: Row; kind: "reject" | "reimburse" } | null>(null);
  const { confirm } = useFeedback();
  const { run } = useAction();
  const list = usePaged((page) => eco.expenses({ page, limit: 20, status: tab, sort: "expenseDate" }), [tab]);
  const approve = async (r: Row) => {
    if (await confirm({ title: `Approve ${inr(r.amount)}?`, message: `${r.employeeName} · ${r.category}`, confirmLabel: "Approve" }))
      if (await run(() => eco.expenseAction(r.id, "approve"), "Expense approved")) list.reload(true);
  };
  return (
    <>
      <PageHeader title="Expenses" subtitle="Approve or reject claims; record reimbursement once paid (outside the system)." />
      <div className="card">
        <div className="toolbar">
          <Tabs value={tab} onChange={(t) => (setTab(t), list.setPage(1))} items={[{ value: "submitted", label: "To approve" }, { value: "approved", label: "To reimburse" }, { value: "reimbursed", label: "Reimbursed" }, { value: "rejected", label: "Rejected" }]} />
        </div>
        <DataTable
          state={list}
          empty="Nothing here"
          columns={[
            { key: "expenseDate", label: "Date", render: (r) => inDate(r.expenseDate) },
            { key: "employeeName", label: "Employee" },
            { key: "category", label: "Category" },
            { key: "description", label: "Description", render: (r) => r.description || "—" },
            { key: "amount", label: "Amount", className: "num", render: (r) => <b>{inr(r.amount)}</b> },
            { key: "receipt", label: "Receipt", render: (r) => (r.receiptKey ? <Button size="sm" onClick={() => eco.fileUrl(r.receiptKey).then((u) => window.open(u.url, "_blank", "noopener"))}>View</Button> : <span className="muted">None</span>) },
            { key: "status", label: "Status", render: (r) => (<><StatusBadge status={r.status} />{r.rejectionReason && <div className="cell-sub">{r.rejectionReason}</div>}{r.reimbursementRef && <div className="cell-sub">Ref {r.reimbursementRef}</div>}</>) },
            {
              key: "actions",
              label: "",
              render: (r) => (
                <div className="row-actions">
                  {r.status === "submitted" && (
                    <>
                      <Button size="sm" variant="success" icon={<Check size={14} />} onClick={() => approve(r)}>Approve</Button>
                      <Button size="sm" variant="danger" icon={<X size={14} />} onClick={() => setDialog({ row: r, kind: "reject" })}>Reject</Button>
                    </>
                  )}
                  {r.status === "approved" && <Button size="sm" icon={<Wallet size={14} />} onClick={() => setDialog({ row: r, kind: "reimburse" })}>Mark reimbursed</Button>}
                </div>
              ),
            },
          ]}
        />
      </div>
      {dialog?.kind === "reject" && <ReasonModal title="Reject expense" danger confirmLabel="Reject" onClose={() => setDialog(null)} onSubmit={async (reason) => (await eco.expenseAction(dialog.row.id, "reject", { reason }), list.reload(true))} />}
      {dialog?.kind === "reimburse" && <ReasonModal title={`Reimbursed ${inr(dialog.row.amount)}?`} label="Payment reference" optional confirmLabel="Mark reimbursed" onClose={() => setDialog(null)} onSubmit={async (reference) => (await eco.expenseAction(dialog.row.id, "reimburse", reference ? { reference } : {}), list.reload(true))} />}
    </>
  );
}

// ── Leave and holidays ──────────────────────────────────────────────────────────

export function Leaves() {
  const [tab, setTab] = useState<"pending" | "approved" | "rejected" | "calendar">("pending");
  const [month, setMonth] = useState(todayIn().slice(0, 7));
  const [rejecting, setRejecting] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const { confirm } = useFeedback();
  const { run } = useAction();
  const list = usePaged((page) => (tab === "calendar" ? Promise.resolve({ items: [], meta: { page: 1, limit: 20, total: 0, pages: 1 } }) : eco.leaves({ page, limit: 20, status: tab, sort: "fromDate", order: tab === "pending" ? "asc" : "desc" })), [tab]);
  const holidays = useAsync(() => eco.holidays(month.slice(0, 4)), [month.slice(0, 4)]);
  const monthLeaves = useAsync(() => (tab === "calendar" ? eco.leaves({ status: "approved", from: `${month}-01`, to: `${month}-31`, limit: 100 }) : Promise.resolve(null)), [tab, month]);

  const events = useMemo(() => {
    const out: CalEvent[] = (holidays.data ?? []).map((h) => ({ date: h.holidayDate, label: h.name, kind: "holiday" }));
    for (const l of monthLeaves.data?.items ?? []) {
      for (let d = new Date(`${l.fromDate}T12:00:00`); d <= new Date(`${l.toDate}T12:00:00`); d.setDate(d.getDate() + 1)) out.push({ date: d.toLocaleDateString("en-CA"), label: `${l.employeeName} (leave)`, kind: "event" as const });
    }
    return out;
  }, [holidays.data, monthLeaves.data]);

  const approve = async (r: Row) => {
    if (await confirm({ title: "Approve leave?", message: `${r.employeeName} · ${inDate(r.fromDate)} to ${inDate(r.toDate)} · ${words(r.leaveType)}`, confirmLabel: "Approve" }))
      if (await run(() => eco.leaveAction(r.id, "approve"), "Leave approved")) list.reload(true);
  };
  const removeHoliday = async (h: Row) => {
    if (await confirm({ title: `Remove ${h.name}?`, message: inDate(h.holidayDate), confirmLabel: "Remove", danger: true }))
      if (await run(() => eco.deleteHoliday(h.id), "Holiday removed")) holidays.reload(true);
  };

  return (
    <>
      <PageHeader title="Leave and holidays" actions={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setAdding(true)}>Add holiday</Button>} />
      <div className="card">
        <div className="toolbar">
          <Tabs value={tab} onChange={(t) => (setTab(t), list.setPage(1))} items={[{ value: "pending", label: "To approve" }, { value: "approved", label: "Approved" }, { value: "rejected", label: "Rejected" }, { value: "calendar", label: "Calendar" }]} />
        </div>
        {tab === "calendar" ? (
          <MonthCalendar month={month} onMonth={setMonth} events={events} />
        ) : (
          <DataTable
            state={list}
            empty="No leave requests"
            columns={[
              { key: "employeeName", label: "Employee" },
              { key: "dates", label: "Dates", render: (r) => `${inDate(r.fromDate)} – ${inDate(r.toDate)}` },
              { key: "leaveType", label: "Type", render: (r) => words(r.leaveType) },
              { key: "reason", label: "Reason", render: (r) => r.reason || "—" },
              { key: "status", label: "Status", render: (r) => (<><StatusBadge status={r.status} />{r.decisionNote && <div className="cell-sub">{r.decisionNote}</div>}</>) },
              {
                key: "actions",
                label: "",
                render: (r) =>
                  r.status === "pending" && (
                    <div className="row-actions">
                      <Button size="sm" variant="success" icon={<Check size={14} />} onClick={() => approve(r)}>Approve</Button>
                      <Button size="sm" variant="danger" icon={<X size={14} />} onClick={() => setRejecting(r)}>Reject</Button>
                    </div>
                  ),
              },
            ]}
          />
        )}
      </div>
      <div className="card">
        <div className="card-head"><h2>Holidays {month.slice(0, 4)}</h2></div>
        {!holidays.data ? <Spinner /> : !holidays.data.length ? <p className="muted">No holidays added for this year.</p> : (
          <ul className="list">{holidays.data.map((h) => <li key={h.id} className="list-row"><div className="list-main"><div className="cell-title">{h.name}</div><div className="cell-sub">{inDate(h.holidayDate)}{h.isOptional ? " · optional" : ""}</div></div><Button size="sm" variant="ghost" icon={<Trash2 size={14} />} aria-label="Remove" onClick={() => removeHoliday(h)} /></li>)}</ul>
        )}
      </div>
      {rejecting && <ReasonModal title="Reject leave" label="Note to the employee" danger confirmLabel="Reject" onClose={() => setRejecting(null)} onSubmit={async (note) => (await eco.leaveAction(rejecting.id, "reject", { note }), list.reload(true))} />}
      {adding && <HolidayModal onClose={() => setAdding(false)} onSaved={() => (setAdding(false), holidays.reload(true))} />}
    </>
  );
}

function HolidayModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ holidayDate: todayIn(), name: "", isOptional: false });
  const { busy, run } = useAction();
  return (
    <Modal title="Add holiday" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!f.name.trim()} onClick={() => run(async () => (await eco.createHoliday({ ...f, name: f.name.trim() }), onSaved()), "Holiday added")}>Add</Button></>}>
      <div className="form">
        <Field label="Date" required>{(id) => <input id={id} type="date" value={f.holidayDate} onChange={(e) => setF({ ...f, holidayDate: e.target.value })} />}</Field>
        <Field label="Name" required>{(id) => <input id={id} maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <label className="check"><input type="checkbox" checked={f.isOptional} onChange={(e) => setF({ ...f, isOptional: e.target.checked })} /> Optional holiday (not counted in payroll)</label>
      </div>
    </Modal>
  );
}

// ── Payroll ─────────────────────────────────────────────────────────────────────

export function Payroll() {
  const [month, setMonth] = useState(todayIn().slice(0, 7));
  const [adjusting, setAdjusting] = useState<Row | null>(null);
  const { confirm, toast } = useFeedback();
  const { busy, run } = useAction();
  const list = usePaged((page) => eco.payroll({ page, limit: 50, month, sort: "name", order: "asc" }), [month]);
  const rows = list.data?.items ?? [];
  const allFinal = rows.length > 0 && rows.every((r) => r.status === "finalized");
  const total = rows.reduce((s, r) => s + (Number(r.netPayable) || 0), 0);

  const generate = async () => {
    const r = await (async () => {
      let out: Row | null = null;
      const ok = await run(async () => (out = await eco.generatePayroll(month)));
      return ok ? out : null;
    })();
    if (r) {
      toast(`Generated: ${(r as Row).created} new, ${(r as Row).updated} refreshed${(r as Row).skipped?.length ? `, ${(r as Row).skipped.length} locked` : ""}`);
      list.reload(true);
    }
  };
  const step = async (r: Row, action: "approve" | "finalize") => {
    const ok = await confirm({
      title: action === "approve" ? `Approve ${r.employeeName}'s payroll?` : `Finalize ${r.employeeName}'s payroll?`,
      message: action === "finalize" ? <>Net payable {inr(r.netPayable)}. <b>Once finalized it is locked and cannot be changed.</b></> : `Net payable ${inr(r.netPayable)}.`,
      confirmLabel: action === "approve" ? "Approve" : "Finalize",
      danger: action === "finalize",
    });
    if (ok && (await run(() => eco.payrollAction(r.id, action), action === "approve" ? "Approved" : "Finalized and locked"))) list.reload(true);
  };
  const bulk = async (from: string, action: "approve" | "finalize") => {
    const targets = rows.filter((r) => r.status === from);
    if (!targets.length) return;
    const ok = await confirm({ title: `${action === "approve" ? "Approve" : "Finalize"} ${targets.length} record(s)?`, message: action === "finalize" ? "Finalized records are locked permanently." : "Approved records can no longer be adjusted.", confirmLabel: action === "approve" ? "Approve all" : "Finalize all", danger: action === "finalize" });
    if (!ok) return;
    await run(async () => {
      for (const r of targets) await eco.payrollAction(r.id, action);
    }, `${targets.length} record(s) ${action === "approve" ? "approved" : "finalized"}`);
    list.reload(true);
  };

  return (
    <>
      <PageHeader
        title="Payroll"
        subtitle="Fixed salary ÷ calculation days × payable days + adjustments. Day rules come from the payroll settings."
        actions={
          <>
            <input type="month" aria-label="Month" value={month} max={todayIn().slice(0, 7)} onChange={(e) => (setMonth(e.target.value), list.setPage(1))} style={{ width: "auto" }} />
            <Button variant="primary" busy={busy} disabled={allFinal} onClick={generate}>Generate {monthLabel(month)}</Button>
            <Button icon={<Download size={16} />} onClick={() => eco.reportCsv("hr", { section: "payroll", from: `${month}-01`, to: `${month}-28` }).catch((e) => toast(String(e.message ?? e), "error"))}>CSV</Button>
          </>
        }
      />
      {allFinal && <div className="locked-banner"><Lock size={16} /> {monthLabel(month)} is finalized and locked.</div>}
      <div className="card">
        <div className="toolbar">
          <span className="muted">{rows.length} employee(s) · total net payable <b>{inr(total)}</b></span>
          <div className="button-row">
            <Button size="sm" disabled={!rows.some((r) => r.status === "draft")} onClick={() => bulk("draft", "approve")}>Approve all drafts</Button>
            <Button size="sm" variant="danger" disabled={!rows.some((r) => r.status === "approved")} onClick={() => bulk("approved", "finalize")}>Finalize all approved</Button>
          </div>
        </div>
        <DataTable
          state={list}
          empty={`No payroll for ${monthLabel(month)} yet`}
          emptyHint="Press Generate to calculate it from attendance, leave and holidays."
          columns={[
            { key: "employeeName", label: "Employee", render: (r) => (<><div>{r.employeeName}</div><div className="cell-sub">{r.employeeCode}</div></>) },
            { key: "fixedSalary", label: "Fixed salary", className: "num", render: (r) => inr(r.fixedSalary) },
            { key: "calcDays", label: "Calc. days", className: "num" },
            { key: "payableDays", label: "Payable days", className: "num" },
            { key: "unpaidLeaveDays", label: "Unpaid days", className: "num" },
            { key: "adjustments", label: "Adjustments", className: "num", render: (r) => (<><div>{inr(r.adjustments)}</div>{r.adjustmentNote && <div className="cell-sub">{r.adjustmentNote}</div>}</>) },
            { key: "netPayable", label: "Net payable", className: "num", render: (r) => <b>{inr(r.netPayable)}</b> },
            { key: "status", label: "Status", render: (r) => (<><StatusBadge status={r.status} />{r.finalizedAt && <div className="cell-sub">{inDateTime(r.finalizedAt)}</div>}</>) },
            {
              key: "actions",
              label: "",
              render: (r) =>
                r.status === "finalized" ? (
                  <Lock size={15} className="muted" aria-label="Locked" />
                ) : (
                  <div className="row-actions">
                    {r.status === "draft" && <Button size="sm" icon={<Pencil size={14} />} onClick={() => setAdjusting(r)}>Adjust</Button>}
                    {r.status === "draft" && <Button size="sm" onClick={() => step(r, "approve")}>Approve</Button>}
                    {r.status === "approved" && <Button size="sm" variant="danger" onClick={() => step(r, "finalize")}>Finalize</Button>}
                  </div>
                ),
            },
          ]}
        />
      </div>
      {adjusting && <AdjustModal row={adjusting} onClose={() => setAdjusting(null)} onSaved={() => (setAdjusting(null), list.reload(true))} />}
    </>
  );
}

function AdjustModal({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(row.adjustments ?? 0));
  const [note, setNote] = useState(row.adjustmentNote ?? "");
  const [error, setError] = useState("");
  const { busy, run } = useAction();
  const n = Number(amount);
  const preview = Number.isFinite(n) ? (row.fixedSalary / row.calcDays) * row.payableDays + n : NaN;
  const save = async () => {
    if (!Number.isFinite(n) || !/^-?\d+(\.\d{1,2})?$/.test(amount)) return setError("Enter an amount (negative for a deduction).");
    if (n !== 0 && !note.trim()) return setError("A note is required for an adjustment.");
    if (await run(() => eco.adjustPayroll(row.id, n, note.trim() || undefined), "Adjustment saved")) onSaved();
  };
  return (
    <Modal title={`Adjust ${row.employeeName}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
      <div className="form">
        <Field label="Adjustment (₹)" hint="Bonus as a positive amount, deduction as negative.">{(id) => <input id={id} type="number" step="0.01" value={amount} onChange={(e) => (setAmount(e.target.value), setError(""))} />}</Field>
        <Field label="Note" required={n !== 0}>{(id) => <input id={id} maxLength={300} value={note} onChange={(e) => (setNote(e.target.value), setError(""))} />}</Field>
        <p>New net payable: <b>{Number.isFinite(preview) ? inr(Math.round(preview * 100) / 100) : "—"}</b></p>
        {error && <ErrorBox error={error} />}
      </div>
    </Modal>
  );
}
