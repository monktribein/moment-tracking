import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, KeyRound, Pencil, UserRoundCog } from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { can } from "../../eco/access";
import { inDate, inDateTime } from "../../eco/format";
import { KV, StatusBadge, TempPasswordModal, useAction } from "../../eco/ui";
import { useViewer } from "../../eco/viewer";
import { Badge, Button, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, Tabs, useFeedback } from "../../components/ui";
import { useAsync } from "../../hooks";
import { DistributorForm, useSalesExecutives } from "./Distributors";

type Tab = "profile" | "visits" | "followups" | "requests";

export default function DistributorDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const viewer = useViewer();
  const manage = can(viewer, "distributors.manage");
  const [tab, setTab] = useState<Tab>("profile");
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [temp, setTemp] = useState<string | null>(null);
  const d = useAsync(() => eco.distributor(id), [id]);
  const history = useAsync(() => eco.distributorHistory(id), [id]);
  const executives = useSalesExecutives(manage);
  const { confirm } = useFeedback();
  const { busy, run } = useAction();

  if (d.error) return <ErrorBox error={d.error} onRetry={() => d.reload()} />;
  if (!d.data) return <Spinner />;
  const x = d.data;
  const h = history.data;

  const togglePortal = async () => {
    const enable = !x.portalAccess;
    const ok = await confirm({
      title: enable ? "Give portal access?" : "Turn off portal access?",
      message: enable ? `${x.firmName} will sign in to the portal with ${x.mobile}.` : "They are signed out and cannot sign in to the portal.",
      confirmLabel: enable ? "Give access" : "Turn off",
      danger: !enable,
    });
    if (!ok) return;
    await run(async () => {
      const r = await eco.portalAccess(id, enable);
      if (r.temporaryPassword) setTemp(r.temporaryPassword);
      d.setData(r.distributor);
    }, enable ? "Portal access on" : "Portal access off");
  };

  return (
    <>
      <PageHeader
        title={x.firmName}
        subtitle={<>{x.distributorCode} · {[x.city, x.state].filter(Boolean).join(", ")} · <StatusBadge status={x.isActive ? "active" : "inactive"} /></>}
        actions={
          <>
            <Button icon={<ArrowLeft size={16} />} onClick={() => navigate(-1)}>Back</Button>
            {can(viewer, "purchases.create") && <Button onClick={() => navigate(`/purchase-requests/new?distributor=${id}`)}>Create request</Button>}
            {manage && (
              <>
                <Button icon={<UserRoundCog size={16} />} onClick={() => setAssigning(true)}>Assign executive</Button>
                <Button icon={<KeyRound size={16} />} busy={busy} onClick={togglePortal}>{x.portalAccess ? "Turn off portal" : "Give portal access"}</Button>
                <Button variant="primary" icon={<Pencil size={16} />} onClick={() => setEditing(true)}>Edit</Button>
              </>
            )}
          </>
        }
      />
      <div className="card">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: "profile", label: "Profile" },
            { value: "visits", label: "Visits", count: h?.visits?.length },
            { value: "followups", label: "Follow-ups", count: h?.followups?.length },
            { value: "requests", label: "Requests", count: h?.requests?.length },
          ]}
        />
        <div style={{ marginTop: 14 }}>
          {tab === "profile" ? (
            <KV
              items={[
                ["Contact person", x.contactPerson],
                ["Mobile", x.mobile],
                ["Alternate mobile", x.altMobile],
                ["Email", x.email],
                ["GSTIN", x.gstin && <span className="mono">{x.gstin}</span>],
                ["Address", [x.address, x.city, x.state, x.pin].filter(Boolean).join(", ")],
                ["Assigned executive", x.executiveName ?? <Badge>Unassigned</Badge>],
                ["Portal access", x.portalAccess ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>],
                ["Remarks", x.remarks],
                ["Added", inDate(x.createdAt)],
              ]}
            />
          ) : history.error ? (
            <ErrorBox error={history.error} />
          ) : !h ? (
            <Spinner />
          ) : (
            <HistoryTable tab={tab} rows={h[tab] ?? []} onRequest={(rid) => navigate(`/purchase-requests/${rid}`)} />
          )}
        </div>
      </div>
      {editing && <DistributorForm distributor={x} executives={executives} onClose={() => setEditing(false)} onSaved={(n) => (setEditing(false), d.setData({ ...x, ...n }))} />}
      {assigning && (
        <AssignModal
          executives={executives}
          current={x.assignedExecutiveId}
          onClose={() => setAssigning(false)}
          onSave={async (employeeId, reason) => {
            d.setData(await eco.assignExecutive(id, employeeId, reason));
            history.reload(true);
          }}
        />
      )}
      {temp && <TempPasswordModal title="Portal login created" who={`${x.contactPerson} (${x.mobile})`} password={temp} onClose={() => setTemp(null)} />}
    </>
  );
}

function HistoryTable({ tab, rows, onRequest }: { tab: Exclude<Tab, "profile">; rows: Row[]; onRequest: (id: string) => void }) {
  if (!rows.length) return <Empty title={`No ${tab === "followups" ? "follow-ups" : tab} yet`} />;
  const head =
    tab === "visits" ? ["Date", "Purpose", "Employee", "Priority", "Status"] : tab === "followups" ? ["Due", "Source", "Employee", "Notes", "Status"] : ["Request", "Created", "Source", "Items", "Payment", "Status"];
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{head.map((x) => <th key={x}>{x}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) =>
            tab === "visits" ? (
              <tr key={r.id}><td>{inDate(r.visitDate)}</td><td>{r.purpose || "—"}</td><td>{r.employeeName}</td><td><StatusBadge status={r.priority} /></td><td><StatusBadge status={r.status} /></td></tr>
            ) : tab === "followups" ? (
              <tr key={r.id}><td>{inDate(r.dueDate)}</td><td><StatusBadge status={r.source} /></td><td>{r.employeeName}</td><td>{r.notes || "—"}</td><td><StatusBadge status={r.status} /></td></tr>
            ) : (
              <tr key={r.id} className="clickable" onClick={() => onRequest(r.id)}><td className="mono">{r.requestNo}</td><td>{inDateTime(r.createdAt)}</td><td><StatusBadge status={r.source} /></td><td>{r.itemCount}</td><td><StatusBadge status={r.paymentStatus} /></td><td><StatusBadge status={r.status} /></td></tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function AssignModal({ executives, current, onClose, onSave }: { executives: Row[]; current: string | null; onClose: () => void; onSave: (id: string, reason?: string) => Promise<void> }) {
  const [employeeId, setEmployeeId] = useState(current ?? "");
  const [reason, setReason] = useState("");
  const { busy, run } = useAction();
  return (
    <Modal
      title="Assign executive"
      onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!employeeId || employeeId === current} onClick={async () => (await run(() => onSave(employeeId, reason.trim() || undefined), "Executive assigned")) && onClose()}>Assign</Button></>}
    >
      <div className="form">
        <Field label="Executive" required>
          {(id) => (
            <select id={id} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Choose…</option>
              {executives.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
        </Field>
        <Field label="Reason" hint="Kept in the assignment history.">{(id) => <input id={id} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
