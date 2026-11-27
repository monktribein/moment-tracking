import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, RefreshCw, Search, XCircle } from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { inDate, inDateTime, inr } from "../../eco/format";
import { DataTable, ReasonModal, SignedImageButton, StatusBadge, usePaged } from "../../eco/ui";
import { Badge, Button, PageHeader, Tabs } from "../../components/ui";
import { useDebounced } from "../../hooks";

type Tab = "pending" | "verified" | "rejected" | "duplicate";

/** Reviewer queue: check each payment against the bank records, then verify or reject with a reason. */
export default function PaymentQueue() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("pending");
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState(false);
  const term = useDebounced(search.trim());
  const [acting, setActing] = useState<{ row: Row; kind: "verify" | "reject" } | null>(null);
  const list = usePaged((page) => eco.paymentQueue({ page, limit: 20, status: tab, search: term, includeHistory: history || undefined, sort: "createdAt", order: tab === "pending" ? "asc" : "desc" }), [tab, term, history]);

  return (
    <>
      <PageHeader
        title="Payment verification"
        subtitle="Verify only after finding the amount and reference in the bank statement. A screenshot alone is not confirmation."
        actions={<Button icon={<RefreshCw size={16} />} onClick={() => list.reload(true)}>Refresh</Button>}
      />
      <div className="card">
        <div className="toolbar">
          <Tabs<Tab>
            value={tab}
            onChange={(t) => (setTab(t), list.setPage(1))}
            items={[
              { value: "pending", label: "Pending", count: tab === "pending" ? list.data?.meta.total : undefined },
              { value: "verified", label: "Verified" },
              { value: "rejected", label: "Rejected" },
              { value: "duplicate", label: "Duplicate warning" },
            ]}
          />
          <div className="filters">
            <div className="search">
              <Search size={16} />
              <input placeholder="Request no., firm, UTR…" value={search} onChange={(e) => (setSearch(e.target.value), list.setPage(1))} />
            </div>
            <label className="check">
              <input type="checkbox" checked={history} onChange={(e) => (setHistory(e.target.checked), list.setPage(1))} /> Include replaced submissions
            </label>
          </div>
        </div>
        <DataTable
          state={list}
          empty={tab === "pending" ? "Nothing waiting for verification" : "No payments here"}
          columns={[
            { key: "requestNo", label: "Request", render: (r) => (<><button type="button" className="link-button mono" onClick={() => navigate(`/purchase-requests/${r.requestId}`)}>{r.requestNo}</button><div className="cell-sub">{r.distributorName}</div></>) },
            { key: "creator", label: "Submitted by", render: (r) => (<><div>{r.creatorName ?? "—"}</div><div className="cell-sub">{inDateTime(r.createdAt)}</div></>) },
            { key: "amount", label: "Amount", className: "num", render: (r) => <b>{inr(r.amount)}</b> },
            { key: "method", label: "Method / date", render: (r) => (<><div>{String(r.method).toUpperCase()}</div><div className="cell-sub">{inDate(r.paymentDate)}</div></>) },
            {
              key: "utr",
              label: "UTR",
              render: (r) => (
                <>
                  <div className="mono">{r.utrNormalized}</div>
                  {r.utrAlreadyVerified ? <Badge tone="red">Already verified elsewhere</Badge> : r.duplicateCount > 0 ? <Badge tone="amber"><AlertTriangle size={12} /> Used {r.duplicateCount + 1}×</Badge> : null}
                </>
              ),
            },
            { key: "history", label: "Corrections", render: (r) => (r.submissionCount > 1 ? `${r.submissionCount} submissions` : "—") },
            { key: "status", label: "Status", render: (r) => (<><StatusBadge status={r.status} />{r.rejectionReason && <div className="cell-sub">{r.rejectionReason}</div>}{!r.isActive && <div className="cell-sub">replaced</div>}</>) },
            {
              key: "actions",
              label: "",
              render: (r) => (
                <div className="row-actions">
                  <SignedImageButton label="Proof" load={() => eco.proofUrl(r.id)} />
                  {r.status === "pending" && r.isActive && ["submitted", "under_review"].includes(r.requestStatus) && (
                    <>
                      <Button size="sm" variant="success" icon={<CheckCircle2 size={14} />} disabled={r.utrAlreadyVerified} onClick={() => setActing({ row: r, kind: "verify" })}>Verify</Button>
                      <Button size="sm" variant="danger" icon={<XCircle size={14} />} onClick={() => setActing({ row: r, kind: "reject" })}>Reject</Button>
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>
      {acting?.kind === "verify" && (
        <ReasonModal
          title={`Verify ${inr(acting.row.amount)} for ${acting.row.requestNo}?`}
          message={<>UTR <b className="mono">{acting.row.utrNormalized}</b>. Confirm you found it in the bank records.</>}
          label="Note"
          optional
          confirmLabel="Mark verified"
          onClose={() => setActing(null)}
          onSubmit={async (note) => (await eco.requestAction(acting.row.requestId, "verify-payment", note ? { note } : {}), list.reload(true))}
        />
      )}
      {acting?.kind === "reject" && (
        <ReasonModal
          title={`Reject the payment for ${acting.row.requestNo}?`}
          message="The submitter is told the reason and can correct and resubmit."
          danger
          confirmLabel="Reject payment"
          onClose={() => setActing(null)}
          onSubmit={async (reason) => (await eco.requestAction(acting.row.requestId, "reject-payment", { reason }), list.reload(true))}
        />
      )}
    </>
  );
}
