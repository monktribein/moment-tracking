import { useMemo, useState, type FormEvent } from "react";
import { adminApi, staffApi } from "../api";
import { place } from "../format";
import type { Lead, LeadInterest, Region, SaveLead, Staff } from "../types";
import { Button, ErrorBox, Field, Modal, errorText, useFeedback } from "./ui";

export type LeadMode = "admin" | "staff";

const INTERESTS: LeadInterest[] = ["Interested", "Follow-up Required", "Not Interested"];

interface FormState {
  name: string;
  ownerName: string;
  ownerPhone: string;
  address: string;
  city: string;
  region: string; // "state|district" (admin only)
  googleMapsUrl: string;
  lat: string;
  lng: string;
  totalRooms: string;
  onlineRooms: string;
  offlineRooms: string;
  roomPrice: string;
  interest: LeadInterest;
  meetingRequested: boolean;
  meetingTime: string;
  meetingMode: string;
  notes: string;
  assignedAgentId: string;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export const regionKey = (r: { state: string; district: string }) => `${r.state}|${r.district}`;

function initialState(lead?: Lead): FormState {
  return {
    name: lead?.name ?? "",
    ownerName: lead?.contact?.ownerName ?? "",
    ownerPhone: lead?.contact?.phone ?? "",
    address: lead?.location?.address ?? "",
    city: lead?.location?.city ?? "",
    region: lead?.location?.state && lead?.location?.district ? regionKey(lead.location) : "",
    googleMapsUrl: lead?.location?.googleMapsUrl ?? "",
    lat: str(lead?.location?.coordinates?.lat),
    lng: str(lead?.location?.coordinates?.lng),
    totalRooms: str(lead?.roomInventory?.totalRooms),
    onlineRooms: str(lead?.roomInventory?.onlineRooms),
    offlineRooms: str(lead?.roomInventory?.offlineRooms),
    roomPrice: str(lead?.roomInventory?.roomPrice),
    interest: lead?.interest ?? "Interested",
    meetingRequested: lead?.meeting?.requested ?? false,
    meetingTime: lead?.meeting?.time ?? "",
    meetingMode: lead?.meeting?.mode ?? "",
    notes: lead?.notes ?? "",
    assignedAgentId: lead?.assignedAgentId ? String(lead.assignedAgentId) : "",
  };
}

/**
 * The field agents a lead can be assigned to: active ones, those of the lead's
 * district first. The current assignee stays listed even if no longer active.
 */
export function AgentOptions({
  agents,
  district,
  current,
}: {
  agents: Staff[];
  district?: string;
  current?: { id: string; name: string } | null;
}) {
  const active = agents
    .filter((a) => a.role === "field_agent" && a.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name));
  const d = (district ?? "").trim().toLowerCase();
  const near = d ? active.filter((a) => a.district.trim().toLowerCase() === d) : [];
  const far = active.filter((a) => !near.includes(a));
  const label = (a: Staff) => `${a.name}${a.employeeCode ? ` (${a.employeeCode})` : ""} — ${place(a)}`;
  const listed = current && !active.some((a) => a._id === current.id);
  return (
    <>
      <option value="">Not assigned</option>
      {listed && <option value={current.id}>{current.name} (current)</option>}
      {near.length > 0 && (
        <optgroup label={`In ${district}`}>
          {near.map((a) => (
            <option key={a._id} value={a._id}>
              {label(a)}
            </option>
          ))}
        </optgroup>
      )}
      {far.length > 0 &&
        (near.length > 0 ? (
          <optgroup label="Other districts">
            {far.map((a) => (
              <option key={a._id} value={a._id}>
                {label(a)}
              </option>
            ))}
          </optgroup>
        ) : (
          far.map((a) => (
            <option key={a._id} value={a._id}>
              {label(a)}
            </option>
          ))
        ))}
    </>
  );
}

export function LeadForm({
  mode,
  lead,
  regions = [],
  fieldAgents,
  fixedArea,
  onClose,
  onSaved,
}: {
  mode: LeadMode;
  lead?: Lead;
  regions?: Region[];
  fieldAgents: Staff[];
  /** Staff mode: the signed-in user's area; the server files their leads there. */
  fixedArea?: { state: string; district: string };
  onClose: () => void;
  onSaved: (lead: Lead) => void;
}) {
  const { toast } = useFeedback();
  const [f, setF] = useState<FormState>(() => initialState(lead));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editing = Boolean(lead);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setF((s) => ({ ...s, [key]: value }));

  // An edited lead keeps its area in the list even if the region was removed since.
  const regionOptions = useMemo(() => {
    const list = [...regions];
    if (lead?.location?.state && lead.location.district && !list.some((r) => regionKey(r) === regionKey(lead.location)))
      list.push({ state: lead.location.state, district: lead.location.district, source: "custom" });
    return list;
  }, [regions, lead]);

  const district = mode === "staff" ? fixedArea?.district : f.region.split("|")[1];

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (f.name.trim().length < 2) next.name = "Enter the property name (2 characters or more).";
    if (mode === "admin" && !f.region) next.region = "Choose the district this property is in.";
    const digits = f.ownerPhone.replace(/\D/g, "");
    if (f.ownerPhone.trim() && digits.length < 10) next.ownerPhone = "Enter a 10-digit mobile number.";
    for (const key of ["totalRooms", "onlineRooms", "offlineRooms"] as const)
      if (f[key].trim() && !(Number.isInteger(Number(f[key])) && Number(f[key]) >= 0)) next[key] = "Whole number, 0 or more.";
    if (f.roomPrice.trim() && !(Number(f.roomPrice) >= 0)) next.roomPrice = "Enter an amount, 0 or more.";
    const lat = Number(f.lat);
    const lng = Number(f.lng);
    if (f.lat.trim() && !(lat >= -90 && lat <= 90)) next.lat = "Between -90 and 90.";
    if (f.lng.trim() && !(lng >= -180 && lng <= 180)) next.lng = "Between -180 and 180.";
    if (Boolean(f.lat.trim()) !== Boolean(f.lng.trim())) next[f.lat.trim() ? "lng" : "lat"] = "Enter both latitude and longitude.";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!validate()) return;
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    const [state, regionDistrict] = f.region.split("|");
    const body: SaveLead = {
      name: f.name.trim(),
      location: {
        address: f.address.trim(),
        city: f.city.trim(),
        googleMapsUrl: f.googleMapsUrl.trim(),
        coordinates: { lat: num(f.lat), lng: num(f.lng) },
        ...(mode === "admin" ? { state, district: regionDistrict } : {}),
      },
      contact: { ownerName: f.ownerName.trim(), phone: f.ownerPhone.trim() },
      roomInventory: {
        totalRooms: num(f.totalRooms),
        onlineRooms: num(f.onlineRooms),
        offlineRooms: num(f.offlineRooms),
        roomPrice: num(f.roomPrice),
      },
      interest: f.interest,
      meeting: {
        requested: f.meetingRequested,
        time: f.meetingRequested ? f.meetingTime.trim() : "",
        mode: f.meetingRequested ? f.meetingMode : "",
      },
      notes: f.notes.trim(),
      assignedAgentId: f.assignedAgentId,
    };
    setBusy(true);
    try {
      const api = mode === "admin" ? adminApi : staffApi;
      const saved = lead ? await api.updateLead(lead._id, body) : await api.createLead(body);
      toast(editing ? "Lead updated" : f.assignedAgentId ? "Lead added and assigned" : "Lead added");
      onSaved(saved);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const current = lead?.assignedAgentId ? { id: String(lead.assignedAgentId), name: lead.assignedAgentName || "Assigned agent" } : null;

  return (
    <Modal
      title={editing ? "Edit lead" : "New lead"}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="lead-form" busy={busy}>
            {editing ? "Save changes" : "Add lead"}
          </Button>
        </>
      }
    >
      <form id="lead-form" className="form" onSubmit={submit} noValidate>
        <h3 className="form-section">Property</h3>
        <div className="grid-2">
          <Field label="Property name" required error={errors.name} className="span-2">
            {(id) => <input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Shree Radhe Guest House" autoFocus />}
          </Field>
          <Field label="Owner name">
            {(id) => <input id={id} value={f.ownerName} onChange={(e) => set("ownerName", e.target.value)} />}
          </Field>
          <Field label="Owner mobile" error={errors.ownerPhone}>
            {(id) => <input id={id} type="tel" inputMode="tel" value={f.ownerPhone} onChange={(e) => set("ownerPhone", e.target.value)} />}
          </Field>
        </div>

        <h3 className="form-section">Location</h3>
        <div className="grid-2">
          {mode === "admin" ? (
            <Field label="District" required error={errors.region}>
              {(id) => (
                <select id={id} value={f.region} onChange={(e) => set("region", e.target.value)}>
                  <option value="">Choose a district…</option>
                  {regionOptions.map((r) => (
                    <option key={regionKey(r)} value={regionKey(r)}>
                      {r.district}, {r.state}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            <Field label="District" hint="Your leads are filed under your own district.">
              {(id) => <input id={id} value={place(fixedArea)} disabled />}
            </Field>
          )}
          <Field label="City / area">
            {(id) => <input id={id} value={f.city} onChange={(e) => set("city", e.target.value)} />}
          </Field>
          <Field label="Address" className="span-2">
            {(id) => <input id={id} value={f.address} onChange={(e) => set("address", e.target.value)} />}
          </Field>
          <Field label="Google Maps link" className="span-2">
            {(id) => <input id={id} type="url" value={f.googleMapsUrl} onChange={(e) => set("googleMapsUrl", e.target.value)} placeholder="https://maps.google.com/…" />}
          </Field>
          <Field label="Latitude" error={errors.lat} hint="Optional">
            {(id) => <input id={id} inputMode="decimal" value={f.lat} onChange={(e) => set("lat", e.target.value)} />}
          </Field>
          <Field label="Longitude" error={errors.lng} hint="Optional">
            {(id) => <input id={id} inputMode="decimal" value={f.lng} onChange={(e) => set("lng", e.target.value)} />}
          </Field>
        </div>

        <h3 className="form-section">Rooms</h3>
        <div className="grid-4">
          <Field label="Total rooms" error={errors.totalRooms}>
            {(id) => <input id={id} inputMode="numeric" value={f.totalRooms} onChange={(e) => set("totalRooms", e.target.value)} />}
          </Field>
          <Field label="Online rooms" error={errors.onlineRooms}>
            {(id) => <input id={id} inputMode="numeric" value={f.onlineRooms} onChange={(e) => set("onlineRooms", e.target.value)} />}
          </Field>
          <Field label="Offline rooms" error={errors.offlineRooms}>
            {(id) => <input id={id} inputMode="numeric" value={f.offlineRooms} onChange={(e) => set("offlineRooms", e.target.value)} />}
          </Field>
          <Field label="Room price (₹)" error={errors.roomPrice}>
            {(id) => <input id={id} inputMode="decimal" value={f.roomPrice} onChange={(e) => set("roomPrice", e.target.value)} />}
          </Field>
        </div>

        <h3 className="form-section">Follow-up</h3>
        <div className="grid-2">
          <Field label="Interest">
            {(id) => (
              <select id={id} value={f.interest} onChange={(e) => set("interest", e.target.value as LeadInterest)}>
                {INTERESTS.map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Assign to field agent" hint={mode === "staff" ? "Field agents of your district." : "The agent sees this lead in their app."}>
            {(id) => (
              <select id={id} value={f.assignedAgentId} onChange={(e) => set("assignedAgentId", e.target.value)}>
                <AgentOptions agents={fieldAgents} district={district} current={current} />
              </select>
            )}
          </Field>
          <label className="check span-2">
            <input type="checkbox" checked={f.meetingRequested} onChange={(e) => set("meetingRequested", e.target.checked)} />
            The owner wants a meeting
          </label>
          {f.meetingRequested && (
            <>
              <Field label="Meeting time">
                {(id) => <input id={id} value={f.meetingTime} onChange={(e) => set("meetingTime", e.target.value)} placeholder="e.g. 25 Nov, 11 am" />}
              </Field>
              <Field label="Meeting mode">
                {(id) => (
                  <select id={id} value={f.meetingMode} onChange={(e) => set("meetingMode", e.target.value)}>
                    <option value="">Not decided</option>
                    <option>Call</option>
                    <option>In-person</option>
                  </select>
                )}
              </Field>
            </>
          )}
          <Field label="Notes" className="span-2">
            {(id) => <textarea id={id} rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} />}
          </Field>
        </div>
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  );
}
