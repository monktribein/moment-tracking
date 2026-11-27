import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, RefreshCw, Search } from "lucide-react";
import { eco } from "../../eco/api";
import { can } from "../../eco/access";
import { inDateTime, words } from "../../eco/format";
import { PurchaseForm } from "../../eco/PurchaseForm";
import { DataTable, StatusBadge, usePaged } from "../../eco/ui";
import { useViewer } from "../../eco/viewer";
import { Button, Field, PageHeader } from "../../components/ui";
import { useAsync, useDebounced } from "../../hooks";

export const PR_STATUSES = ["draft", "submitted", "under_review", "correction_required", "approved", "processed", "rejected", "cancelled"];

export default function PurchaseRequests() {
  const viewer = useViewer();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const status = params.get("status") ?? "";
  const source = params.get("source") ?? "";
  const distributorId = params.get("distributor") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const setParam = (k: string, v: string) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (v) n.set(k, v);
      else n.delete(k);
      return n;
    }, { replace: true });
  const distributors = useAsync(() => eco.distributors({ limit: 100, sort: "firmName", order: "asc" }), []);
  const list = usePaged((page) => eco.requests({ page, limit: 20, search: term, status, source, distributorId, from, to }), [term, status, source, distributorId, from, to]);

  return (
    <>
      <PageHeader
        title="Purchase requests"
        subtitle="Requests from the portal, the field app and the office. Approve once the payment is verified."
        actions={
          <>
            <Button icon={<RefreshCw size={16} />} onClick={() => list.reload(true)}>Refresh</Button>
            {can(viewer, "purchases.create") && <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate("/purchase-requests/new")}>Create request for distributor</Button>}
          </>
        }
      />
      <div className="card">
        <div className="toolbar">
          <div className="filters">
            <div className="search">
              <Search size={16} />
              <input placeholder="Request no., firm…" value={search} onChange={(e) => (setSearch(e.target.value), list.setPage(1))} />
            </div>
            <select value={status} onChange={(e) => (setParam("status", e.target.value), list.setPage(1))} aria-label="Status">
              <option value="">All statuses</option>
              {PR_STATUSES.map((s) => <option key={s} value={s}>{words(s)}</option>)}
            </select>
            <select value={source} onChange={(e) => (setParam("source", e.target.value), list.setPage(1))} aria-label="Source">
              <option value="">All sources</option>
              <option value="portal">Portal</option>
              <option value="android">Android</option>
              <option value="web">Web</option>
            </select>
            <select value={distributorId} onChange={(e) => (setParam("distributor", e.target.value), list.setPage(1))} aria-label="Distributor">
              <option value="">All distributors</option>
              {(distributors.data?.items ?? []).map((d) => <option key={d.id} value={d.id}>{d.firmName}</option>)}
            </select>
            <input type="date" aria-label="From" value={from} onChange={(e) => (setParam("from", e.target.value), list.setPage(1))} />
            <input type="date" aria-label="To" value={to} onChange={(e) => (setParam("to", e.target.value), list.setPage(1))} />
          </div>
        </div>
        <DataTable
          state={list}
          empty="No purchase requests"
          onRow={(r) => navigate(`/purchase-requests/${r.id}`)}
          columns={[
            { key: "requestNo", label: "Request", render: (r) => (<><div className="cell-title mono">{r.requestNo}</div><div className="cell-sub">{inDateTime(r.createdAt)}</div></>) },
            { key: "distributorName", label: "Distributor" },
            { key: "source", label: "Source", render: (r) => words(r.source) },
            { key: "creatorName", label: "Created by" },
            { key: "totalQuantity", label: "Units", className: "num" },
            { key: "paymentStatus", label: "Payment", render: (r) => <StatusBadge status={r.paymentStatus} /> },
            { key: "status", label: "Status", render: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      </div>
    </>
  );
}

/** "Create request for distributor": an employee picks a distributor they are authorized for. */
export function PurchaseCreate() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [distributorId, setDistributorId] = useState(params.get("distributor") ?? "");
  const distributors = useAsync(() => eco.distributors({ limit: 100, active: true, sort: "firmName", order: "asc" }), []);
  return (
    <>
      <PageHeader title="Create request for distributor" subtitle="Only active products. The payment proof is stored privately." />
      <div className="card">
        <Field label="Distributor" required hint="You can only choose distributors you are authorized for.">
          {(id) => (
            <select id={id} value={distributorId} onChange={(e) => setDistributorId(e.target.value)}>
              <option value="">Choose…</option>
              {(distributors.data?.items ?? []).map((d) => <option key={d.id} value={d.id}>{d.firmName} · {d.distributorCode}</option>)}
            </select>
          )}
        </Field>
      </div>
      <PurchaseForm distributorId={distributorId || undefined} source="web" onDone={(r) => navigate(`/purchase-requests/${r.id}`, { replace: true })} />
    </>
  );
}
