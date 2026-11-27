import { useState } from "react";
import { CheckCircle2, FileCheck2, PackageCheck, Pencil, XCircle } from "lucide-react";
import { eco, type Row } from "./api";
import { can, type Viewer } from "./access";
import { inDate, inDateTime, inr, words } from "./format";
import { PurchaseForm, PAYMENT_METHODS } from "./PurchaseForm";
import { KV, ReasonModal, SignedImageButton, StatusBadge, Timeline } from "./ui";
import { Button, ErrorBox, Field, Modal, Spinner, useFeedback } from "../components/ui";
import { useAsync } from "../hooks";
import { useAction } from "./ui";

const methodName = (m: string) => PAYMENT_METHODS.find(([v]) => v === m)?.[1] ?? words(m);

/**
 * A purchase request with items, the active payment, version history and status timeline, and the
 * actions the viewer is allowed to take. Shared by the admin screen and the distributor portal.
 */
export function RequestDetail({ id, viewer, portal }: { id: string; viewer: Viewer; portal?: boolean }) {
  const r = useAsync(() => eco.request(id), [id]);
  const h = useAsync(() => eco.requestHistory(id), [id]);
  const [dialog, setDialog] = useState<"reject" | "rejectPayment" | "verify" | "process" | "cancel" | "correct" | null>(null);
  const { confirm } = useFeedback();
  const { busy, run } = useAction();
  const refresh = () => (r.reload(true), h.reload(true));

  if (r.error) return <ErrorBox error={r.error} onRetry={() => r.reload()} />;
  if (!r.data) return <Spinner />;
  const x = r.data;
  const p = x.payment;
  const isOwner = portal || x.creatorUserId === undefined || can(viewer, "purchases.create");
  const editable = ["draft", "correction_required"].includes(x.status);
  const payable = ["submitted", "under_review"].includes(x.status) && p?.status === "pending";

  const approve = async () => {
    if (!(await confirm({ title: `Approve ${x.requestNo}?`, message: "The payment is verified. Approved requests can no longer be edited.", confirmLabel: "Approve" }))) return;
    if (await run(() => eco.requestAction(id, "approve"), "Request approved")) refresh();
  };

  const timeline = [
    ...(h.data?.statusLog ?? []).map((l: Row) => ({ at: l.at, title: l.fromStatus ? `${words(l.fromStatus)} → ${words(l.toStatus)}` : words(l.toStatus), sub: [l.actorName, l.reason].filter(Boolean).join(" · "), status: l.toStatus })),
  ];

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="mono">{x.requestNo}</h2>
            <div className="cell-sub">
              {x.distributorName} · {words(x.source)} · created {inDateTime(x.createdAt)} by {x.creatorName ?? "—"} · version {x.version}
            </div>
          </div>
          <StatusBadge status={x.status} />
        </div>
        {x.status === "correction_required" && <ErrorBox error={`Correction required${p?.rejectionReason ? `: ${p.rejectionReason}` : ""}. Fix the details and resubmit.`} />}
        {x.rejectionReason && x.status === "rejected" && <ErrorBox error={`Rejected: ${x.rejectionReason}`} />}
        <div className="button-row" style={{ marginTop: 10, flexWrap: "wrap" }}>
          {editable && isOwner && x.status === "correction_required" && <Button variant="primary" icon={<Pencil size={15} />} onClick={() => setDialog("correct")}>Correct &amp; resubmit</Button>}
          {can(viewer, "payments.verify") && payable && (
            <>
              <Button variant="success" icon={<CheckCircle2 size={15} />} onClick={() => setDialog("verify")}>Verify payment</Button>
              <Button variant="danger" icon={<XCircle size={15} />} onClick={() => setDialog("rejectPayment")}>Reject payment</Button>
            </>
          )}
          {can(viewer, "purchases.approve") && x.status === "under_review" && (
            <Button variant="primary" icon={<FileCheck2 size={15} />} busy={busy} disabled={x.paymentStatus !== "verified"} title={x.paymentStatus !== "verified" ? "Verify the payment first" : undefined} onClick={approve}>
              Approve
            </Button>
          )}
          {can(viewer, "purchases.approve") && ["submitted", "under_review", "correction_required"].includes(x.status) && <Button variant="danger" onClick={() => setDialog("reject")}>Reject request</Button>}
          {can(viewer, "purchases.process") && x.status === "approved" && <Button className="btn-accent" icon={<PackageCheck size={15} />} onClick={() => setDialog("process")}>Mark processed</Button>}
          {["draft", "submitted", "under_review", "correction_required"].includes(x.status) && isOwner && <Button variant="ghost" onClick={() => setDialog("cancel")}>Cancel request</Button>}
        </div>
      </div>

      <div className="two-col two-col-wide-left">
        <div className="card">
          <div className="card-head"><h2>Items</h2></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Product</th><th>Model</th><th>SKU</th><th className="num">Qty</th><th>Remarks</th></tr></thead>
              <tbody>
                {x.items.map((i: Row) => (
                  <tr key={i.id}><td>{i.productSnapshot?.name}</td><td>{i.productSnapshot?.model}</td><td className="mono">{i.productSnapshot?.sku}</td><td className="num">{i.quantity}</td><td>{i.remarks || "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {x.remarks && <p className="muted">Remarks: {x.remarks}</p>}
          {x.externalInvoiceRef && <p>Invoice reference: <b className="mono">{x.externalInvoiceRef}</b></p>}
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Payment</h2>
            <StatusBadge status={p?.status ?? x.paymentStatus} />
          </div>
          {!p ? (
            <p className="muted">No payment submitted yet.</p>
          ) : (
            <>
              <KV items={[["Amount", <b>{inr(p.amount)}</b>], ["Method", methodName(p.method)], ["Payment date", inDate(p.paymentDate)], ["UTR", <span className="mono">{p.utrRaw}</span>], ["Normalized UTR", <span className="mono">{p.utrNormalized}</span>], ["Reviewed", p.reviewedAt ? inDateTime(p.reviewedAt) : "—"], ["Rejection reason", p.rejectionReason]]} />
              {p.proof && <SignedImageButton label="View payment proof" load={() => eco.proofUrl(p.id)} />}
              {x.paymentSubmissions > 1 && <p className="muted small">{x.paymentSubmissions} submissions in total; earlier ones are kept in the history.</p>}
            </>
          )}
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head"><h2>Status timeline</h2></div>
          {h.error ? <ErrorBox error={h.error} /> : !h.data ? <Spinner /> : <Timeline items={timeline} format={inDateTime} />}
        </div>
        <div className="card">
          <div className="card-head"><h2>Versions and payments</h2></div>
          {!h.data ? (
            <Spinner />
          ) : (
            <>
              {(h.data.versions ?? []).map((v: Row) => (
                <details key={v.id} className="form-section">
                  <summary>
                    Version {v.version} · {inDateTime(v.createdAt)} · {v.reason}
                  </summary>
                  <ul>
                    {(v.snapshot?.items ?? []).map((i: Row) => (
                      <li key={i.id}>{i.productSnapshot?.name} × {i.quantity}</li>
                    ))}
                  </ul>
                  {v.snapshot?.payment && <p className="muted small">Payment {inr(v.snapshot.payment.amount)} · UTR {v.snapshot.payment.utrRaw}</p>}
                </details>
              ))}
              <div className="section-title">Payment submissions</div>
              <ul className="list">
                {(h.data.payments ?? []).map((pp: Row) => (
                  <li key={pp.id} className="list-row">
                    <div className="list-main">
                      <div>{inr(pp.amount)} · {methodName(pp.method)} · <span className="mono">{pp.utrRaw}</span></div>
                      <div className="cell-sub">{inDateTime(pp.createdAt)}{pp.rejectionReason ? ` · ${pp.rejectionReason}` : ""}{pp.isActive ? " · current" : ""}</div>
                    </div>
                    <StatusBadge status={pp.status} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {dialog === "verify" && (
        <ReasonModal title="Verify payment" label="Note" optional confirmLabel="Mark verified" message="Confirm you found this amount and reference in the bank records. A screenshot alone is not proof." onClose={() => setDialog(null)} onSubmit={async (note) => (await eco.requestAction(id, "verify-payment", note ? { note } : {}), refresh())} />
      )}
      {dialog === "rejectPayment" && <ReasonModal title="Reject payment" danger confirmLabel="Reject payment" message="The request goes back to the submitter for correction." onClose={() => setDialog(null)} onSubmit={async (reason) => (await eco.requestAction(id, "reject-payment", { reason }), refresh())} />}
      {dialog === "reject" && <ReasonModal title={`Reject ${x.requestNo}?`} danger confirmLabel="Reject request" message="This is final." onClose={() => setDialog(null)} onSubmit={async (reason) => (await eco.requestAction(id, "reject", { reason }), refresh())} />}
      {dialog === "cancel" && <ReasonModal title={`Cancel ${x.requestNo}?`} optional danger confirmLabel="Cancel request" onClose={() => setDialog(null)} onSubmit={async (reason) => (await eco.requestAction(id, "cancel", reason ? { reason } : {}), refresh())} />}
      {dialog === "process" && <ProcessModal onClose={() => setDialog(null)} onSubmit={async (ref) => (await eco.requestAction(id, "process", ref ? { externalInvoiceRef: ref } : {}), refresh())} />}
      {dialog === "correct" && (
        <Modal title={`Correct ${x.requestNo}`} onClose={() => setDialog(null)} wide>
          <PurchaseForm correction={x} onDone={() => (setDialog(null), refresh())} />
        </Modal>
      )}
    </>
  );
}

function ProcessModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (ref: string) => Promise<unknown> }) {
  const [ref, setRef] = useState("");
  const { busy, run } = useAction();
  return (
    <Modal title="Mark as processed" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={async () => (await run(() => onSubmit(ref.trim()), "Marked processed")) && onClose()}>Mark processed</Button></>}>
      <div className="form">
        <p>The invoice is raised outside the system. Record its reference here.</p>
        <Field label="External invoice reference">{(id) => <input id={id} maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} autoFocus />}</Field>
      </div>
    </Modal>
  );
}
