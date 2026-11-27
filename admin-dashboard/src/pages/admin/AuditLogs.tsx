import { useState } from "react";
import { Search } from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { inDateTime, words } from "../../eco/format";
import { DataTable, usePaged } from "../../eco/ui";
import { Button, Modal, PageHeader } from "../../components/ui";
import { useDebounced } from "../../hooks";

const ENTITIES = ["purchase_request", "purchase_payment", "distributor", "employee", "product", "complaint", "sales_visit", "followup", "call_log", "attendance", "expense", "leave", "payroll", "holiday", "role", "customer", "user"];

/** Read-only audit trail (the table is append-only: nobody can edit it). */
export default function AuditLogs() {
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Row | null>(null);
  const term = useDebounced(search.trim());
  const act = useDebounced(action.trim());
  const list = usePaged((page) => eco.auditLogs({ page, limit: 25, entity, action: act, from, to, search: term }), [entity, act, from, to, term]);

  return (
    <>
      <PageHeader title="Audit log" subtitle="Who changed what, when and why. Entries cannot be edited or deleted." />
      <div className="card">
        <div className="toolbar">
          <div className="filters">
            <div className="search">
              <Search size={16} />
              <input placeholder="Search action, entity, reason…" value={search} onChange={(e) => (setSearch(e.target.value), list.setPage(1))} />
            </div>
            <select value={entity} onChange={(e) => (setEntity(e.target.value), list.setPage(1))} aria-label="Record type">
              <option value="">All record types</option>
              {ENTITIES.map((x) => <option key={x} value={x}>{words(x)}</option>)}
            </select>
            <input placeholder="Exact action, e.g. purchase.approve" value={action} onChange={(e) => (setAction(e.target.value), list.setPage(1))} aria-label="Action" />
            <input type="date" aria-label="From" value={from} onChange={(e) => (setFrom(e.target.value), list.setPage(1))} />
            <input type="date" aria-label="To" value={to} onChange={(e) => (setTo(e.target.value), list.setPage(1))} />
          </div>
        </div>
        <DataTable
          state={list}
          empty="No audit entries"
          onRow={setOpen}
          columns={[
            { key: "at", label: "When", render: (r) => inDateTime(r.at) },
            { key: "actor", label: "Who", render: (r) => (<><div>{r.actorName ?? "System"}</div><div className="cell-sub">{words(r.actorRole)}</div></>) },
            { key: "action", label: "Action", render: (r) => <span className="mono">{r.action}</span> },
            { key: "entity", label: "Record", render: (r) => (<><div>{words(r.entity)}</div><div className="cell-sub mono">{r.entityId ?? ""}</div></>) },
            { key: "reason", label: "Reason", render: (r) => r.reason || "—" },
          ]}
        />
      </div>
      {open && (
        <Modal title={open.action} onClose={() => setOpen(null)} wide footer={<Button onClick={() => setOpen(null)}>Close</Button>}>
          <div className="grid-2">
            <div>
              <div className="section-title">Before</div>
              <pre className="pre">{open.oldValues ? JSON.stringify(open.oldValues, null, 2) : "—"}</pre>
            </div>
            <div>
              <div className="section-title">After</div>
              <pre className="pre">{open.newValues ? JSON.stringify(open.newValues, null, 2) : "—"}</pre>
            </div>
          </div>
          <p className="muted small">
            {inDateTime(open.at)} · {open.actorName ?? "System"} · IP {open.ip ?? "—"}
          </p>
        </Modal>
      )}
    </>
  );
}
