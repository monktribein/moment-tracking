import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Clock, ExternalLink, Pencil, Phone, Trash2, UserCheck } from "lucide-react";
import { adminApi, staffApi, type LeadDecision } from "../api";
import { fmtDateTime, fmtMoney, hasFix, mapsUrl, place, roleLabel } from "../format";
import { useAsync } from "../hooks";
import type { Lead, Region, Staff } from "../types";
import { InterestBadge, LeadStatusBadge } from "./badges";
import { AgentOptions, LeadForm, type LeadMode } from "./LeadForm";
import { Badge, Button, Drawer, ErrorBox, Spinner, errorText, useFeedback } from "./ui";

const DECISIONS: {
  decision: LeadDecision;
  label: string;
  done: string;
  variant: "success" | "danger" | "primary" | "secondary";
  when: (s: Lead["status"]) => boolean;
}[] = [
  { decision: "approve", label: "Approve", done: "Lead approved", variant: "success", when: (s) => s === "pending" || s === "rejected" },
  { decision: "convert", label: "Mark converted", done: "Lead marked as converted", variant: "primary", when: (s) => s === "approved" },
  { decision: "reject", label: "Reject", done: "Lead rejected", variant: "danger", when: (s) => s === "pending" || s === "approved" },
  { decision: "reopen", label: "Reopen for review", done: "Lead reopened for review", variant: "secondary", when: (s) => s !== "pending" },
];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="kv-row">
      <dt>{label}</dt>
      <dd>{children || <span className="muted">—</span>}</dd>
    </div>
  );
}

export function LeadDrawer({
  mode,
  leadId,
  fieldAgents,
  regions,
  fixedArea,
  onClose,
  onChanged,
}: {
  mode: LeadMode;
  leadId: string;
  fieldAgents: Staff[];
  regions?: Region[];
  fixedArea?: { state: string; district: string };
  onClose: () => void;
  /** After a change; null when the lead was deleted. */
  onChanged: (lead: Lead | null) => void;
}) {
  const api = mode === "admin" ? adminApi : staffApi;
  const { toast, confirm } = useFeedback();
  const { data: lead, error, loading, reload, setData } = useAsync(() => api.lead(leadId), [leadId, mode]);
  const [agentId, setAgentId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setAgentId(lead?.assignedAgentId ? String(lead.assignedAgentId) : "");
  }, [lead?.assignedAgentId]);

  const changed = (next: Lead | null) => {
    if (next) setData(next);
    onChanged(next);
  };

  const run = async (key: string, action: () => Promise<Lead>, message: string) => {
    setBusy(key);
    try {
      changed(await action());
      toast(message);
      return true;
    } catch (err) {
      toast(errorText(err), "error");
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (loading && !lead)
    return (
      <Drawer title="Lead" onClose={onClose}>
        <Spinner />
      </Drawer>
    );
  if (error || !lead)
    return (
      <Drawer title="Lead" onClose={onClose}>
        <ErrorBox error={error ?? "Lead not found"} onRetry={() => reload()} />
      </Drawer>
    );

  const pending = lead.status === "pending";
  const canEdit = mode === "admin" || pending;
  const canAssign = mode === "admin" || pending;
  const currentId = lead.assignedAgentId ? String(lead.assignedAgentId) : "";
  const current = currentId ? { id: currentId, name: lead.assignedAgentName || "Assigned agent" } : null;
  const point = lead.location?.coordinates;
  const mapLink = lead.location?.googleMapsUrl || (hasFix(point) ? mapsUrl(point.lat, point.lng) : "");
  const rooms = lead.roomInventory ?? {};

  const assign = () =>
    run("assign", () => api.assignLead(lead._id, agentId || null), agentId ? "Lead assigned" : "Assignment removed");

  const decide = async (decision: LeadDecision, done: string) => {
    if (await run(decision, () => adminApi.decideLead(lead._id, decision, note), done)) setNote("");
  };

  const remove = async () => {
    const ok = await confirm({
      title: "Delete this lead?",
      message: (
        <>
          <strong>{lead.name}</strong> will be deleted for everyone, including the field agent it is assigned to. This cannot
          be undone.
        </>
      ),
      confirmLabel: "Delete lead",
      danger: true,
    });
    if (!ok) return;
    setBusy("delete");
    try {
      await adminApi.deleteLead(lead._id);
      toast("Lead deleted");
      onChanged(null);
      onClose();
    } catch (err) {
      toast(errorText(err), "error");
      setBusy(null);
    }
  };

  return (
    <>
      <Drawer
        title={lead.name}
        subtitle={
          <span className="inline-gap">
            <LeadStatusBadge status={lead.status} />
            <span>{[lead.location?.city, place(lead.location)].filter(Boolean).join(" · ")}</span>
          </span>
        }
        onClose={onClose}
        footer={
          <>
            {mode === "admin" && (
              <Button variant="ghost" icon={<Trash2 size={16} />} onClick={remove} busy={busy === "delete"} className="danger-text">
                Delete
              </Button>
            )}
            <span className="spacer" />
            {canEdit && (
              <Button icon={<Pencil size={16} />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </>
        }
      >
        <section className="panel">
          <h3 className="panel-title">
            <UserCheck size={16} /> Field agent
          </h3>
          {current ? (
            <div className="assignee">
              <div>
                <strong>{lead.assignedAgentName}</strong>
                {lead.assignedAgentCode && <span className="muted"> · {lead.assignedAgentCode}</span>}
              </div>
              {lead.fieldVerified ? (
                <Badge tone="green">
                  <CheckCircle2 size={13} /> Visited{lead.fieldVerifiedAt ? ` ${fmtDateTime(lead.fieldVerifiedAt)}` : ""}
                </Badge>
              ) : (
                <Badge tone="amber">
                  <Clock size={13} /> Visit pending
                </Badge>
              )}
            </div>
          ) : (
            <p className="muted">Not assigned to a field agent yet.</p>
          )}
          {canAssign ? (
            <div className="assign-row">
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Field agent">
                <AgentOptions agents={fieldAgents} district={mode === "staff" ? fixedArea?.district : lead.location?.district} current={current} />
              </select>
              <Button variant="primary" onClick={assign} busy={busy === "assign"} disabled={agentId === currentId}>
                {agentId ? (currentId ? "Reassign" : "Assign") : "Unassign"}
              </Button>
            </div>
          ) : (
            <p className="muted small">This lead has been reviewed, so it can no longer be reassigned.</p>
          )}
        </section>

        {mode === "admin" && (
          <section className="panel">
            <h3 className="panel-title">Review</h3>
            {lead.reviewedAt && (
              <p className="small">
                Last decision by <strong>{lead.reviewedByAdminName || "admin"}</strong> on {fmtDateTime(lead.reviewedAt)}
                {lead.reviewNote && <> — “{lead.reviewNote}”</>}
              </p>
            )}
            <textarea rows={2} placeholder="Note for this decision (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            <div className="button-row">
              {DECISIONS.filter((d) => d.when(lead.status)).map((d) => (
                <Button key={d.decision} size="sm" variant={d.variant} busy={busy === d.decision} onClick={() => decide(d.decision, d.done)}>
                  {d.label}
                </Button>
              ))}
            </div>
          </section>
        )}

        <section className="panel">
          <h3 className="panel-title">Details</h3>
          <dl className="kv">
            <Row label="Owner">{lead.contact?.ownerName}</Row>
            <Row label="Mobile">
              {lead.contact?.phone && (
                <a href={`tel:${lead.contact.phone}`} className="inline-gap">
                  <Phone size={14} /> {lead.contact.phone}
                </a>
              )}
            </Row>
            <Row label="Address">{lead.location?.address}</Row>
            <Row label="City / area">{lead.location?.city}</Row>
            <Row label="District">{place(lead.location)}</Row>
            <Row label="Map">
              {mapLink && (
                <a href={mapLink} target="_blank" rel="noopener noreferrer" className="inline-gap">
                  Open in Google Maps <ExternalLink size={13} />
                </a>
              )}
            </Row>
            <Row label="Rooms">
              {rooms.totalRooms !== null && rooms.totalRooms !== undefined
                ? `${rooms.totalRooms} total` +
                  (rooms.onlineRooms !== null && rooms.onlineRooms !== undefined ? ` · ${rooms.onlineRooms} online` : "") +
                  (rooms.offlineRooms !== null && rooms.offlineRooms !== undefined ? ` · ${rooms.offlineRooms} offline` : "")
                : ""}
            </Row>
            <Row label="Room price">{rooms.roomPrice !== null && rooms.roomPrice !== undefined ? fmtMoney(rooms.roomPrice) : ""}</Row>
            <Row label="Interest">{lead.interest && <InterestBadge interest={lead.interest} />}</Row>
            <Row label="Meeting">
              {lead.meeting?.requested ? [lead.meeting.time || "Time not set", lead.meeting.mode].filter(Boolean).join(" · ") : "Not requested"}
            </Row>
            <Row label="Notes">{lead.notes && <span className="pre">{lead.notes}</span>}</Row>
            <Row label="Agent notes">{lead.agentNotes && <span className="pre">{lead.agentNotes}</span>}</Row>
          </dl>
          {lead.images?.length > 0 && (
            <div className="thumbs">
              {lead.images
                .filter((src) => /^(https?:|data:image\/)/.test(src))
                .map((src, i) => (
                  <a key={i} href={src} target="_blank" rel="noopener noreferrer">
                    <img src={src} alt={`Photo ${i + 1}`} loading="lazy" />
                  </a>
                ))}
            </div>
          )}
        </section>

        <section className="panel">
          <h3 className="panel-title">History</h3>
          <dl className="kv">
            <Row label="Added">
              {lead.capturedByName || "—"} · {fmtDateTime(lead.capturedAt ?? lead.createdAt)}
            </Row>
            {lead.lastUpdatedByName && (
              <Row label="Last change">
                {lead.lastUpdatedByName}
                {lead.lastUpdatedByRole ? ` (${lead.lastUpdatedByRole === "super_admin" ? "Super Admin" : roleLabel(lead.lastUpdatedByRole)})` : ""} ·{" "}
                {fmtDateTime(lead.updatedAt)}
              </Row>
            )}
            {lead.fieldVerified && <Row label="Field visit">{[lead.fieldVerifiedByName, fmtDateTime(lead.fieldVerifiedAt)].filter(Boolean).join(" · ")}</Row>}
          </dl>
        </section>
      </Drawer>

      {editing && (
        <LeadForm
          mode={mode}
          lead={lead}
          regions={regions}
          fieldAgents={fieldAgents}
          fixedArea={fixedArea}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            changed(saved);
          }}
        />
      )}
    </>
  );
}
