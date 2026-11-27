import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileUp, Plus, Search } from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { can } from "../../eco/access";
import { DataTable, StatusBadge, useAction, usePaged } from "../../eco/ui";
import { useViewer } from "../../eco/viewer";
import { Badge, Button, ErrorBox, Field, Modal, PageHeader } from "../../components/ui";
import { useAsync, useDebounced } from "../../hooks";

export default function Distributors() {
  const viewer = useViewer();
  const manage = can(viewer, "distributors.manage");
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");
  const [portal, setPortal] = useState("");
  const [state, setState] = useState("");
  const [executiveId, setExecutiveId] = useState("");
  const term = useDebounced(search.trim());
  const [editing, setEditing] = useState<Row | "new" | null>(params.get("new") && manage ? "new" : null);
  const [importing, setImporting] = useState(false);
  const list = usePaged((page) => eco.distributors({ page, limit: 20, search: term, active, portal, state, executiveId, sort: "firmName", order: "asc" }), [term, active, portal, state, executiveId]);
  const executives = useSalesExecutives(manage);

  return (
    <>
      <PageHeader
        title="Distributors"
        subtitle="Distributor master: contact details, assigned executive and portal access."
        actions={
          manage && (
            <>
              {can(viewer, "distributors.import") && (
                <Button icon={<FileUp size={16} />} onClick={() => setImporting(true)}>
                  Import CSV
                </Button>
              )}
              <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing("new")}>
                Add distributor
              </Button>
            </>
          )
        }
      />
      <div className="card">
        <div className="toolbar">
          <div className="filters">
            <div className="search">
              <Search size={16} />
              <input placeholder="Firm, contact, mobile, code, city…" value={search} onChange={(e) => (setSearch(e.target.value), list.setPage(1))} />
            </div>
            <input placeholder="State" value={state} onChange={(e) => (setState(e.target.value), list.setPage(1))} aria-label="State" />
            {manage && (
              <select value={executiveId} onChange={(e) => (setExecutiveId(e.target.value), list.setPage(1))} aria-label="Executive">
                <option value="">Any executive</option>
                {executives.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            )}
            <select value={active} onChange={(e) => (setActive(e.target.value), list.setPage(1))} aria-label="Status">
              <option value="">Active and inactive</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
            <select value={portal} onChange={(e) => (setPortal(e.target.value), list.setPage(1))} aria-label="Portal">
              <option value="">Any portal access</option>
              <option value="true">Portal on</option>
              <option value="false">Portal off</option>
            </select>
          </div>
        </div>
        <DataTable
          state={list}
          empty="No distributors"
          onRow={(r) => navigate(`/distributors/${r.id}`)}
          columns={[
            { key: "firmName", label: "Firm", render: (r) => (<><div className="cell-title">{r.firmName}</div><div className="cell-sub">{r.distributorCode}</div></>) },
            { key: "contact", label: "Contact", render: (r) => (<><div>{r.contactPerson}</div><div className="cell-sub">{r.mobile}</div></>) },
            { key: "city", label: "City", render: (r) => [r.city, r.state].filter(Boolean).join(", ") || "—" },
            { key: "executiveName", label: "Executive", render: (r) => r.executiveName || <Badge>Unassigned</Badge> },
            { key: "portalAccess", label: "Portal", render: (r) => (r.portalAccess ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>) },
            { key: "isActive", label: "Status", render: (r) => <StatusBadge status={r.isActive ? "active" : "inactive"} /> },
          ]}
        />
      </div>
      {editing && <DistributorForm distributor={editing === "new" ? null : editing} executives={executives} onClose={() => (setEditing(null), params.get("new") && setParams({}, { replace: true }))} onSaved={(d) => (setEditing(null), list.reload(true), editing === "new" && navigate(`/distributors/${d.id}`))} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={() => list.reload(true)} />}
    </>
  );
}

/** Active sales staff who can own distributors. */
export function useSalesExecutives(enabled = true): Row[] {
  const x = useAsync(() => (enabled ? eco.employees({ limit: 100, active: true, sort: "name", order: "asc" }) : Promise.resolve({ items: [], meta: { page: 1, limit: 0, total: 0, pages: 1 } })), [enabled]);
  return (x.data?.items ?? []).filter((e) => ["tele_sales", "field_sales", "sales_manager"].includes(e.role));
}

export function DistributorForm({ distributor, executives, onClose, onSaved }: { distributor: Row | null; executives: Row[]; onClose: () => void; onSaved: (d: Row) => void }) {
  const fields = ["firmName", "contactPerson", "mobile", "altMobile", "email", "gstin", "address", "city", "state", "pin", "remarks"] as const;
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((k) => [k, distributor?.[k] ?? ""])));
  const [executive, setExecutive] = useState("");
  const [error, setError] = useState("");
  const { busy, run } = useAction();
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[6-9]\d{9}$/.test(f.mobile.replace(/\D/g, "").slice(-10))) return setError("Enter a valid 10-digit mobile number.");
    if (f.gstin && !/^[0-9A-Z]{15}$/i.test(f.gstin)) return setError("GSTIN must be 15 letters/digits.");
    if (f.pin && !/^\d{6}$/.test(f.pin)) return setError("PIN must be 6 digits.");
    const body: Row = Object.fromEntries(Object.entries(f).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    if (!distributor && executive) body.assignedExecutiveId = executive;
    await run(async () => onSaved(distributor ? await eco.updateDistributor(distributor.id, body) : await eco.createDistributor(body)), "Distributor saved");
  };

  const input = (k: string, label: string, required = false, extra: Record<string, unknown> = {}) => (
    <Field label={label} required={required}>
      {(id) => <input id={id} required={required} value={f[k]} onChange={(e) => set(k, e.target.value)} {...extra} />}
    </Field>
  );

  return (
    <Modal
      title={distributor ? `Edit ${distributor.firmName}` : "Add distributor"}
      onClose={onClose}
      wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="distributor-form" busy={busy}>Save</Button></>}
    >
      <form id="distributor-form" className="form" onSubmit={submit}>
        <div className="grid-2">
          {input("firmName", "Firm name", true, { maxLength: 160 })}
          {input("contactPerson", "Contact person", true, { maxLength: 120 })}
          {input("mobile", "Mobile", true, { inputMode: "numeric" })}
          {input("altMobile", "Alternate mobile", false, { inputMode: "numeric" })}
          {input("email", "Email", false, { type: "email" })}
          {input("gstin", "GSTIN", false, { maxLength: 15, style: { textTransform: "uppercase" } })}
          {input("city", "City")}
          {input("state", "State")}
          {input("pin", "PIN", false, { inputMode: "numeric", maxLength: 6 })}
          {!distributor && (
            <Field label="Assigned executive">
              {(id) => (
                <select id={id} value={executive} onChange={(e) => setExecutive(e.target.value)}>
                  <option value="">— Later —</option>
                  {executives.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              )}
            </Field>
          )}
        </div>
        <Field label="Address">{(id) => <textarea id={id} rows={2} maxLength={300} value={f.address} onChange={(e) => set("address", e.target.value)} />}</Field>
        <Field label="Remarks">{(id) => <textarea id={id} rows={2} maxLength={500} value={f.remarks} onChange={(e) => set("remarks", e.target.value)} />}</Field>
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Row | null>(null);
  const { busy, run } = useAction();
  const go = (dryRun: boolean) =>
    run(async () => {
      const r = await eco.importDistributors(file!, dryRun);
      setReport(r);
      if (!dryRun) onDone();
    }, dryRun ? undefined : "Import finished");

  return (
    <Modal
      title="Import distributors from CSV"
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button disabled={!file} busy={busy} onClick={() => go(true)}>Check file</Button>
          <Button variant="primary" disabled={!file} busy={busy} onClick={() => go(false)}>Import valid rows</Button>
        </>
      }
    >
      <div className="form">
        <p className="muted">
          Header row needed. Columns: <span className="mono">firm_name, contact_person, mobile</span> (required) and optional{" "}
          <span className="mono">distributor_code, alt_mobile, email, gstin, address, city, state, pin, remarks, executive_code</span>. Up to 2000 rows, 1 MB.
        </p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => (setFile(e.target.files?.[0] ?? null), setReport(null))} />
        {report && (
          <>
            <div className="kpi-grid">
              <div className="kpi"><span className="kpi-label">Rows</span><span className="kpi-value">{report.total}</span></div>
              <div className="kpi"><span className="kpi-label">{report.dryRun ? "Valid" : "Created"}</span><span className="kpi-value">{report.dryRun ? report.valid : report.created}</span></div>
              <div className="kpi accent"><span className="kpi-label">With errors</span><span className="kpi-value">{report.failed}</span></div>
            </div>
            {report.ignoredColumns?.length > 0 && <p className="muted small">Ignored columns: {report.ignoredColumns.join(", ")}</p>}
            {report.rows?.some((r: Row) => r.status === "failed") && (
              <div className="table-wrap">
                <table className="table import-report">
                  <thead><tr><th>Row</th><th>Firm</th><th>Problems</th></tr></thead>
                  <tbody>
                    {report.rows.filter((r: Row) => r.status === "failed").map((r: Row) => (
                      <tr key={r.row}><td>{r.row}</td><td>{r.firmName || "—"}</td><td className="danger-text">{r.errors.join("; ")}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

