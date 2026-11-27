import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, RotateCcw, Search, UserRoundCog } from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { can } from "../../eco/access";
import { inDate, inDateTime, todayIn, words } from "../../eco/format";
import { DataTable, KV, ReasonModal, StatusBadge, Timeline, useAction, usePaged } from "../../eco/ui";
import { useViewer } from "../../eco/viewer";
import { Button, ErrorBox, Field, Modal, PageHeader, Spinner } from "../../components/ui";
import { useAsync, useDebounced } from "../../hooks";

const STATUSES = ["open", "assigned", "in_progress", "pending", "resolved", "closed", "reopened"];
const CATEGORIES = ["inverter_not_working", "inverter_error_code", "inverter_power_or_charging", "battery_not_charging", "battery_low_backup", "battery_discharge_or_not_working", "other_inverter_battery"];

export function Complaints() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "";
  const [category, setCategory] = useState("");
  const [engineerId, setEngineerId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const engineers = useEngineers();
  const list = usePaged((page) => eco.complaints({ page, limit: 20, status, category, engineerId, from, to, search: term }), [status, category, engineerId, from, to, term]);

  return (
    <>
      <PageHeader title="Complaints" subtitle="Raised by customers from the app. Assign an engineer; the job closes only with the customer's OTP." />
      <div className="card">
        <div className="toolbar">
          <div className="filters">
            <div className="search">
              <Search size={16} />
              <input placeholder="Complaint no., customer, serial…" value={search} onChange={(e) => (setSearch(e.target.value), list.setPage(1))} />
            </div>
            <select value={status} onChange={(e) => (setParams(e.target.value ? { status: e.target.value } : {}, { replace: true }), list.setPage(1))} aria-label="Status">
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{words(s)}</option>)}
            </select>
            <select value={category} onChange={(e) => (setCategory(e.target.value), list.setPage(1))} aria-label="Category">
              <option value="">All issues</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{words(c)}</option>)}
            </select>
            <select value={engineerId} onChange={(e) => (setEngineerId(e.target.value), list.setPage(1))} aria-label="Engineer">
              <option value="">Any engineer</option>
              {engineers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <input type="date" aria-label="From" value={from} onChange={(e) => (setFrom(e.target.value), list.setPage(1))} />
            <input type="date" aria-label="To" value={to} onChange={(e) => (setTo(e.target.value), list.setPage(1))} />
          </div>
        </div>
        <DataTable
          state={list}
          empty="No complaints"
          onRow={(r) => navigate(`/complaints/${r.id}`)}
          columns={[
            { key: "complaintNo", label: "Complaint", render: (r) => (<><div className="cell-title mono">{r.complaintNo}</div><div className="cell-sub">{inDateTime(r.createdAt)}</div></>) },
            { key: "customerName", label: "Customer" },
            { key: "product", label: "Product", render: (r) => (<><div>{r.model}</div><div className="cell-sub mono">{r.serialNo}</div></>) },
            { key: "category", label: "Issue", render: (r) => words(r.category) },
            { key: "engineerName", label: "Engineer", render: (r) => r.engineerName || "—" },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      </div>
    </>
  );
}

function useEngineers(): Row[] {
  const e = useAsync(() => eco.employees({ limit: 100, active: true, role: "field_support", sort: "name", order: "asc" }), []);
  return e.data?.items ?? [];
}

export function ComplaintDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const viewer = useViewer();
  const manage = can(viewer, "complaints.assign");
  const c = useAsync(() => eco.complaint(id), [id]);
  const engineers = useEngineers();
  const [dialog, setDialog] = useState<"assign" | "reopen" | null>(null);

  if (c.error) return <ErrorBox error={c.error} onRetry={() => c.reload()} />;
  if (!c.data) return <Spinner />;
  const x = c.data;
  const canAssign = manage && ["open", "reopened"].includes(x.status);
  const canReassign = manage && ["assigned", "in_progress", "pending"].includes(x.status);

  return (
    <>
      <PageHeader
        title={x.complaintNo}
        subtitle={<>{words(x.category)} · raised {inDateTime(x.createdAt)} · <StatusBadge status={x.status} /></>}
        actions={
          <>
            <Button icon={<ArrowLeft size={16} />} onClick={() => navigate(-1)}>Back</Button>
            {(canAssign || canReassign) && <Button variant="primary" icon={<UserRoundCog size={16} />} onClick={() => setDialog("assign")}>{canAssign ? "Assign engineer" : "Reassign"}</Button>}
            {manage && ["resolved", "closed"].includes(x.status) && <Button icon={<RotateCcw size={16} />} onClick={() => setDialog("reopen")}>Reopen</Button>}
          </>
        }
      />
      <div className="two-col">
        <div className="card">
          <div className="card-head"><h2>Customer and product</h2></div>
          <KV
            items={[
              ["Customer", x.customerName],
              ["Mobile", <a href={`tel:${x.customerMobile}`}>{x.customerMobile}</a>],
              ["Contact for visit", x.contact],
              ["Service address", x.serviceAddress],
              ["Product", `${words(x.productCategory)} · ${x.model}`],
              ["Serial number", <span className="mono">{x.serialNo}</span>],
              ["Warranty", <StatusBadge status={x.warrantyStatus} />],
              ["Engineer", x.engineerName ? `${x.engineerName} (${x.engineerMobile})` : "Not assigned"],
              ["Reopened", x.reopenCount ? `${x.reopenCount} time(s)` : "Never"],
            ]}
          />
          <div className="section-title">Description</div>
          <p style={{ whiteSpace: "pre-wrap" }}>{x.description}</p>
          <div className="button-row">
            {(x.photos ?? []).map((key: string, i: number) => <Button key={key} size="sm" onClick={() => eco.fileUrl(key).then((u) => window.open(u.url, "_blank", "noopener"))}>Photo {i + 1}</Button>)}
            {x.warrantyProofKey && <Button size="sm" onClick={() => eco.fileUrl(x.warrantyProofKey).then((u) => window.open(u.url, "_blank", "noopener"))}>Warranty proof</Button>}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Timeline</h2></div>
          <Timeline
            format={inDateTime}
            items={(x.timeline ?? []).map((t: Row) => ({
              at: t.at,
              status: t.to ?? (t.type === "service_report" ? "resolved" : t.type === "assigned" ? "assigned" : "in_progress"),
              title: t.type === "status" ? (t.from ? `${words(t.from)} → ${words(t.to)}` : words(t.to)) : t.type === "assigned" ? `Assigned to ${t.engineer}` : t.type === "engineer_check_in" ? `${t.engineer} checked in on site` : `Service report by ${t.engineer}`,
              sub: t.reason ?? t.diagnosis ?? (t.scheduledDate ? `visit ${inDate(t.scheduledDate)}` : t.by),
            }))}
          />
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Service reports</h2></div>
        {!x.reports?.length ? (
          <p className="muted">No reports yet. The engineer files them from the mobile app after checking in.</p>
        ) : (
          x.reports.map((r: Row) => (
            <div key={r.id} className="form-section">
              <div className="cell-sub">{inDateTime(r.submittedAt)} · {r.engineerName}</div>
              <KV items={[["Diagnosis", r.diagnosis], ["Action taken", r.actionTaken], ["Notes", r.notes], ["Further action", r.furtherAction]]} />
              <div className="button-row">
                {(r.photos ?? []).map((key: string, i: number) => <Button key={key} size="sm" onClick={() => eco.fileUrl(key).then((u) => window.open(u.url, "_blank", "noopener"))}>Photo {i + 1}</Button>)}
              </div>
            </div>
          ))
        )}
      </div>
      {dialog === "assign" && <AssignEngineerModal reassign={canReassign} engineers={engineers} current={x.engineerId} onClose={() => setDialog(null)} onSave={async (body) => c.setData(await eco.complaintAction(id, canReassign ? "reassign" : "assign", body))} />}
      {dialog === "reopen" && <ReasonModal title={`Reopen ${x.complaintNo}?`} confirmLabel="Reopen" message="The current engineer is unassigned; assign one again." onClose={() => setDialog(null)} onSubmit={async (reason) => c.setData(await eco.complaintAction(id, "reopen", { reason }))} />}
    </>
  );
}

function AssignEngineerModal({ reassign, engineers, current, onClose, onSave }: { reassign: boolean; engineers: Row[]; current: string | null; onClose: () => void; onSave: (body: Row) => Promise<void> }) {
  const [engineerId, setEngineerId] = useState("");
  const [scheduledDate, setScheduledDate] = useState(todayIn());
  const [reason, setReason] = useState("");
  const { busy, run } = useAction();
  const valid = engineerId && engineerId !== current && (!reassign || reason.trim());
  return (
    <Modal
      title={reassign ? "Reassign engineer" : "Assign engineer"}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!valid} onClick={async () => (await run(() => onSave({ engineerId, scheduledDate, ...(reassign ? { reason: reason.trim() } : {}) }), "Engineer assigned")) && onClose()}>Assign and schedule</Button></>}
    >
      <div className="form">
        <Field label="Engineer" required>
          {(id) => (
            <select id={id} value={engineerId} onChange={(e) => setEngineerId(e.target.value)}>
              <option value="">Choose…</option>
              {engineers.filter((e) => e.id !== current).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Visit date" required>{(id) => <input id={id} type="date" min={todayIn()} value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />}</Field>
        {reassign && <Field label="Reason" required>{(id) => <input id={id} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>}
      </div>
    </Modal>
  );
}
