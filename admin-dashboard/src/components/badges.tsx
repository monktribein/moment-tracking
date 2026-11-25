import { LEAD_STATUS_LABELS, roleLabel } from "../format";
import type { LeadStatus } from "../types";
import { Badge, type Tone } from "./ui";

const LEAD_TONES: Record<LeadStatus, Tone> = {
  pending: "amber",
  approved: "green",
  rejected: "red",
  converted: "violet",
};

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  return <Badge tone={LEAD_TONES[status] ?? "gray"}>{LEAD_STATUS_LABELS[status] ?? status}</Badge>;
}

const ROLE_TONES: Record<string, Tone> = {
  field_agent: "blue",
  lead_executive: "indigo",
  field_supervisor: "violet",
  document_verifier: "gray",
};

export function RoleBadge({ role }: { role: string }) {
  return <Badge tone={ROLE_TONES[role] ?? "gray"}>{roleLabel(role)}</Badge>;
}

export function StaffStatusBadge({ status }: { status: string }) {
  return status === "active" ? <Badge tone="green">Active</Badge> : <Badge tone="red">Suspended</Badge>;
}

export function InterestBadge({ interest }: { interest: string }) {
  const tone: Tone = interest === "Interested" ? "green" : interest === "Not Interested" ? "gray" : "amber";
  return <Badge tone={tone}>{interest}</Badge>;
}
