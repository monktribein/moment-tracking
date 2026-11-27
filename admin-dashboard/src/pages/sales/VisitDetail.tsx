import { lazy, Suspense, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CalendarClock, CheckCircle2, XCircle } from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { can } from "../../eco/access";
import { inDate, inDateTime, todayIn, words } from "../../eco/format";
import { KV, ReasonModal, StatusBadge, useAction } from "../../eco/ui";
import { useViewer } from "../../eco/viewer";
import { Button, ErrorBox, Field, Modal, PageHeader, Spinner, useFeedback } from "../../components/ui";
import { useAsync } from "../../hooks";

const PointMap = lazy(() => import("../../eco/PointMap"));

export default function VisitDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const viewer = useViewer();
  const manage = can(viewer, "visits.assign");
  const v = useAsync(() => eco.visit(id), [id]);
  const [dialog, setDialog] = useState<"cancel" | "reschedule" | null>(null);
  const { confirm } = useFeedback();
  const { busy, run } = useAction();

  if (v.error) return <ErrorBox error={v.error} onRetry={() => v.reload()} />;
  if (!v.data) return <Spinner />;
  const x = v.data;
  const r = x.report;

  const complete = async () => {
    if (!(await confirm({ title: "Mark this visit completed?", message: "The report has been reviewed.", confirmLabel: "Complete" }))) return;
    if (await run(() => eco.visitAction(id, "complete"), "Visit completed")) v.reload(true);
  };

  return (
    <>
      <PageHeader
        title={x.distributorName}
        subtitle={<>{inDate(x.visitDate)} · {x.employeeName} · <StatusBadge status={x.status} /></>}
        actions={
          <>
            <Button icon={<ArrowLeft size={16} />} onClick={() => navigate(-1)}>Back</Button>
            {manage && x.status === "report_submitted" && <Button variant="success" icon={<CheckCircle2 size={16} />} busy={busy} onClick={complete}>Complete</Button>}
            {manage && x.status === "scheduled" && (
              <>
                <Button icon={<CalendarClock size={16} />} onClick={() => setDialog("reschedule")}>Reschedule</Button>
                <Button variant="danger" icon={<XCircle size={16} />} onClick={() => setDialog("cancel")}>Cancel</Button>
              </>
            )}
          </>
        }
      />
      <div className="two-col">
        <div className="card">
          <div className="card-head"><h2>Visit</h2></div>
          <KV items={[["Purpose", x.purpose], ["Priority", words(x.priority)], ["Instructions", x.instructions], ["Checked in", x.checkinAt ? inDateTime(x.checkinAt) : "Not yet"], ["Cancel / reschedule reason", x.cancelReason]]} />
          {x.rescheduledToId && <Button size="sm" onClick={() => navigate(`/sales/visits/${x.rescheduledToId}`)}>Open the new visit</Button>}
        </div>
        <div className="card">
          <div className="card-head"><h2>GPS check-in</h2></div>
          {x.checkinLat !== null && x.checkinLat !== undefined ? (
            <Suspense fallback={<Spinner label="Loading map…" />}>
              <PointMap lat={x.checkinLat} lng={x.checkinLng} accuracy={x.checkinAccuracy} label={`${x.employeeName} · ${inDateTime(x.checkinAt)}`} />
            </Suspense>
          ) : (
            <p className="muted">The employee has not checked in yet. Check-in happens in the mobile app at the distributor's location.</p>
          )}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Visit report</h2>{r && <span className="muted">{inDateTime(r.submittedAt)}</span>}</div>
        {!r ? (
          <p className="muted">No report yet.</p>
        ) : (
          <>
            <p style={{ whiteSpace: "pre-wrap" }}>{r.notes}</p>
            <KV items={[["Language", r.transcriptLang ? String(r.transcriptLang).toUpperCase() : "—"], ["Next follow-up", r.nextFollowupDate ? inDate(r.nextFollowupDate) : "—"], ["Photos", `${r.photos?.length ?? 0}`]]} />
            {(r.productRequirements ?? []).length > 0 && (
              <>
                <div className="section-title">Product requirements</div>
                <ul>
                  {r.productRequirements.map((p: Row, i: number) => <li key={i}>{p.productName ?? p.productId ?? "Product"}{p.quantity ? ` × ${p.quantity}` : ""}{p.note ? ` — ${p.note}` : ""}</li>)}
                </ul>
              </>
            )}
            <div className="button-row">
              {(r.photos ?? []).map((key: string, i: number) => (
                <Button key={key} size="sm" onClick={() => eco.fileUrl(key).then((u) => window.open(u.url, "_blank", "noopener"))}>Photo {i + 1}</Button>
              ))}
            </div>
          </>
        )}
      </div>
      {dialog === "cancel" && <ReasonModal title="Cancel visit" danger confirmLabel="Cancel visit" onClose={() => setDialog(null)} onSubmit={async (reason) => (await eco.visitAction(id, "cancel", { reason }), v.reload(true))} />}
      {dialog === "reschedule" && <RescheduleModal onClose={() => setDialog(null)} onSubmit={async (visitDate, reason) => navigate(`/sales/visits/${(await eco.visitAction(id, "reschedule", { visitDate, reason })).id}`, { replace: true })} />}
    </>
  );
}

function RescheduleModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (date: string, reason: string) => Promise<unknown> }) {
  const [date, setDate] = useState(todayIn());
  const [reason, setReason] = useState("");
  const { busy, run } = useAction();
  return (
    <Modal title="Reschedule visit" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!reason.trim()} onClick={async () => (await run(() => onSubmit(date, reason.trim()), "Visit rescheduled")) && onClose()}>Reschedule</Button></>}>
      <div className="form">
        <Field label="New date" required>{(id) => <input id={id} type="date" min={todayIn()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Reason" required>{(id) => <input id={id} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
