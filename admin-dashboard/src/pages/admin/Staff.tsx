import { useMemo, useState, type FormEvent } from "react";
import { Copy, KeyRound, Pencil, Plus, Power, RefreshCw, Search, Trash2, Users, Wand2 } from "lucide-react";
import { adminApi, type StaffInput } from "../../api";
import { RoleBadge, StaffStatusBadge } from "../../components/badges";
import { regionKey } from "../../components/LeadForm";
import { Button, Empty, ErrorBox, Field, Modal, PageHeader, Pagination, Spinner, Tabs, errorText, useFeedback } from "../../components/ui";
import { fmtDateTime, generatePassword, place, ROLE_LABELS } from "../../format";
import { useAsync } from "../../hooks";
import type { Region, Staff, StaffRole } from "../../types";

const PAGE = 25;
type RoleTab = "all" | StaffRole;

const ROLE_HELP: Record<StaffRole, string> = {
  field_agent: "Uses the mobile app: checks in, is tracked on GPS and visits the leads assigned to them.",
  lead_executive: "Signs in to this dashboard to add leads and assign them to field agents of their district.",
  field_supervisor: "Manages the field agents of their district from the app; can also assign leads here.",
  document_verifier: "Checks the documents of the leads in their district from the app.",
};

async function copy(text: string, toast: (t: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    /* clipboard blocked: the text is on screen to copy by hand */
  }
}

export default function StaffPage() {
  const { toast, confirm } = useFeedback();
  const data = useAsync(() => Promise.all([adminApi.allStaff(), adminApi.regions()]), []);
  const [role, setRole] = useState<RoleTab>("all");
  const [status, setStatus] = useState("");
  const [region, setRegion] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Staff | "new" | null>(null);
  const [resetting, setResetting] = useState<Staff | null>(null);
  const [created, setCreated] = useState<{ staff: Staff; password: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [staff, regions] = data.data ?? [[], []];

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: staff.length };
    for (const s of staff) c[s.role] = (c[s.role] ?? 0) + 1;
    return c;
  }, [staff]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter(
      (s) =>
        (role === "all" || s.role === role) &&
        (!status || s.status === status) &&
        (!region || regionKey(s) === region) &&
        (!q || [s.name, s.phone, s.email, s.employeeCode, s.district, s.state].some((v) => String(v ?? "").toLowerCase().includes(q))),
    );
  }, [staff, role, status, region, search]);

  const shown = filtered.slice((page - 1) * PAGE, page * PAGE);
  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const replace = (next: Staff) =>
    data.setData(([list, r] = [[], []]) => {
      const exists = list.some((s) => s._id === next._id);
      return [exists ? list.map((s) => (s._id === next._id ? { ...s, ...next, leadCount: s.leadCount } : s)) : [{ ...next, leadCount: 0 }, ...list], r];
    });

  const toggleStatus = async (s: Staff) => {
    const suspend = s.status === "active";
    if (
      suspend &&
      !(await confirm({
        title: `Suspend ${s.name}?`,
        message: "They are signed out at once and cannot sign in until you activate the account again. Their leads and history are kept.",
        confirmLabel: "Suspend",
        danger: true,
      }))
    )
      return;
    setBusy(s._id);
    try {
      replace(await adminApi.updateStaff(s._id, { status: suspend ? "suspended" : "active" }));
      toast(suspend ? `${s.name} suspended` : `${s.name} is active again`);
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (s: Staff) => {
    const ok = await confirm({
      title: `Delete ${s.name}?`,
      message: "The account is deleted and can no longer sign in. Leads they added are kept. To keep the account for later, suspend it instead.",
      confirmLabel: "Delete account",
      danger: true,
    });
    if (!ok) return;
    setBusy(s._id);
    try {
      const result = await adminApi.deleteStaff(s._id);
      data.setData(([list, r] = [[], []]) => [list.filter((x) => x._id !== s._id), r]);
      toast(`${s.name} deleted${result.leadsRetained ? ` (${result.leadsRetained} leads kept)` : ""}`);
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Field agents, lead executives, supervisors and document verifiers."
        actions={
          <>
            <Button icon={<RefreshCw size={16} />} onClick={() => data.reload(true)}>
              Refresh
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing("new")} disabled={!data.data}>
              Add staff
            </Button>
          </>
        }
      />

      <div className="card">
        <div className="toolbar">
          <Tabs<RoleTab>
            value={role}
            onChange={reset(setRole)}
            items={[
              { value: "all", label: "All", count: counts.all ?? 0 },
              { value: "field_agent", label: "Field agents", count: counts.field_agent ?? 0 },
              { value: "lead_executive", label: "Lead executives", count: counts.lead_executive ?? 0 },
              { value: "field_supervisor", label: "Supervisors", count: counts.field_supervisor ?? 0 },
              { value: "document_verifier", label: "Verifiers", count: counts.document_verifier ?? 0 },
            ]}
          />
          <div className="toolbar-right">
            <div className="search">
              <Search size={16} />
              <input placeholder="Search name, phone, code…" value={search} onChange={(e) => reset(setSearch)(e.target.value)} />
            </div>
            <select value={region} onChange={(e) => reset(setRegion)(e.target.value)} aria-label="District">
              <option value="">All districts</option>
              {regions.map((r) => (
                <option key={regionKey(r)} value={regionKey(r)}>
                  {r.district}, {r.state}
                </option>
              ))}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} aria-label="Status">
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        </div>

        {data.error ? (
          <ErrorBox error={data.error} onRetry={() => data.reload()} />
        ) : data.loading && !data.data ? (
          <Spinner />
        ) : !shown.length ? (
          <Empty icon={<Users size={28} />} title={staff.length ? "Nobody matches" : "No staff yet"}>
            {staff.length ? "Try another filter." : "Add your first field agent or lead executive with Add staff."}
          </Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Mobile</th>
                    <th>Role</th>
                    <th>District</th>
                    <th className="num">Leads</th>
                    <th>Last sign-in</th>
                    <th>Status</th>
                    <th className="actions-col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <tr key={s._id}>
                      <td>
                        <div className="cell-title">{s.name}</div>
                        <div className="cell-sub">{[s.employeeCode, s.email].filter(Boolean).join(" · ") || "—"}</div>
                      </td>
                      <td>{s.phone}</td>
                      <td>
                        <RoleBadge role={s.role} />
                      </td>
                      <td>{place(s) || "—"}</td>
                      <td className="num">{s.leadCount ?? 0}</td>
                      <td className="nowrap">{s.lastLoginAt ? fmtDateTime(s.lastLoginAt) : <span className="muted">Never</span>}</td>
                      <td>
                        <StaffStatusBadge status={s.status} />
                      </td>
                      <td className="actions-col">
                        <div className="row-actions">
                          <button type="button" className="icon-btn" title="Edit" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}>
                            <Pencil size={16} />
                          </button>
                          <button type="button" className="icon-btn" title="Reset password" aria-label={`Reset password of ${s.name}`} onClick={() => setResetting(s)}>
                            <KeyRound size={16} />
                          </button>
                          <button
                            type="button"
                            className={`icon-btn${s.status === "active" ? "" : " text-green"}`}
                            title={s.status === "active" ? "Suspend" : "Activate"}
                            aria-label={`${s.status === "active" ? "Suspend" : "Activate"} ${s.name}`}
                            onClick={() => toggleStatus(s)}
                            disabled={busy === s._id}
                          >
                            <Power size={16} />
                          </button>
                          <button type="button" className="icon-btn danger-text" title="Delete" aria-label={`Delete ${s.name}`} onClick={() => remove(s)} disabled={busy === s._id}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} limit={PAGE} total={filtered.length} onPage={setPage} />
          </>
        )}
      </div>

      {editing && (
        <StaffForm
          staff={editing === "new" ? undefined : editing}
          regions={regions}
          defaultRole={role === "all" ? "field_agent" : role}
          onClose={() => setEditing(null)}
          onSaved={(saved, password) => {
            setEditing(null);
            replace(saved);
            if (password) setCreated({ staff: saved, password });
            else toast("Changes saved");
          }}
        />
      )}

      {resetting && <ResetPassword staff={resetting} onClose={() => setResetting(null)} />}

      {created && (
        <Modal
          title="Account created"
          onClose={() => setCreated(null)}
          footer={
            <Button variant="primary" onClick={() => setCreated(null)}>
              Done
            </Button>
          }
        >
          <p>
            Share these sign-in details with <strong>{created.staff.name}</strong>. The password is not shown again.
          </p>
          <div className="credentials">
            <div>
              <span className="muted">Signs in at</span>
              <strong>{created.staff.role === "lead_executive" || created.staff.role === "field_supervisor" ? "This dashboard (Lead executive) or the app" : "The mobile app"}</strong>
            </div>
            <div>
              <span className="muted">Mobile number</span>
              <strong>{created.staff.phone}</strong>
            </div>
            <div>
              <span className="muted">Password</span>
              <strong className="mono">{created.password}</strong>
            </div>
          </div>
          <Button icon={<Copy size={16} />} onClick={() => copy(`Mobile: ${created.staff.phone}\nPassword: ${created.password}`, toast)}>
            Copy details
          </Button>
        </Modal>
      )}
    </>
  );
}

function StaffForm({
  staff,
  regions,
  defaultRole,
  onClose,
  onSaved,
}: {
  staff?: Staff;
  regions: Region[];
  defaultRole: StaffRole;
  onClose: () => void;
  onSaved: (staff: Staff, password?: string) => void;
}) {
  const editing = Boolean(staff);
  const [f, setF] = useState({
    name: staff?.name ?? "",
    phone: staff?.phone ?? "",
    email: staff?.email ?? "",
    password: editing ? "" : generatePassword(),
    role: (staff?.role ?? defaultRole) as StaffRole,
    status: staff?.status ?? "active",
    region: staff ? regionKey(staff) : regions.length === 1 ? regionKey(regions[0]) : "",
    employeeCode: staff?.employeeCode ?? "",
    notes: staff?.notes ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof f, value: string) => setF((s) => ({ ...s, [key]: value }));

  const regionOptions = useMemo(() => {
    const list = [...regions];
    if (staff && staff.state && !list.some((r) => regionKey(r) === regionKey(staff))) list.push({ state: staff.state, district: staff.district, source: "custom" });
    return list;
  }, [regions, staff]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const next: Record<string, string> = {};
    const digits = f.phone.replace(/\D/g, "");
    if (f.name.trim().length < 2) next.name = "Enter the full name.";
    if (digits.length < 10) next.phone = "Enter a 10-digit mobile number.";
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) next.email = "Enter a valid email or leave it empty.";
    if (!editing && f.password.length < 8) next.password = "At least 8 characters.";
    if (!f.region) next.region = "Choose a district.";
    setErrors(next);
    if (Object.keys(next).length) return;

    const [state, district] = f.region.split("|");
    const full: StaffInput = {
      name: f.name.trim(),
      phone: digits,
      role: f.role,
      status: f.status,
      state,
      district,
      employeeCode: f.employeeCode.trim(),
      notes: f.notes.trim(),
      ...(f.email.trim() ? { email: f.email.trim() } : {}),
    };
    // An edit sends only what changed: the server signs the person out whenever
    // their role, mobile number or district is sent.
    let body: StaffInput = full;
    if (staff) {
      body = {};
      const was: StaffInput = { ...full, name: staff.name, phone: staff.phone, role: staff.role, status: staff.status, employeeCode: staff.employeeCode, notes: staff.notes, email: staff.email };
      for (const key of ["name", "phone", "role", "status", "employeeCode", "notes", "email"] as const)
        if (full[key] !== undefined && full[key] !== (was[key] ?? "")) body[key] = full[key];
      if (regionKey(staff) !== f.region) Object.assign(body, { state, district });
      if (!Object.keys(body).length) return onClose();
    }
    setBusy(true);
    try {
      const saved = staff ? await adminApi.updateStaff(staff._id, body) : await adminApi.createStaff({ ...body, password: f.password });
      onSaved(saved, editing ? undefined : f.password);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? `Edit ${staff?.name}` : "Add staff"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="staff-form" busy={busy}>
            {editing ? "Save changes" : "Create account"}
          </Button>
        </>
      }
    >
      <form id="staff-form" className="form" onSubmit={submit} noValidate>
        <Field label="Role" required hint={ROLE_HELP[f.role]}>
          {(id) => (
            <select id={id} value={f.role} onChange={(e) => set("role", e.target.value)}>
              {(Object.keys(ROLE_LABELS) as StaffRole[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="grid-2">
          <Field label="Full name" required error={errors.name}>
            {(id) => <input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />}
          </Field>
          <Field label="Mobile number" required error={errors.phone} hint="Used to sign in.">
            {(id) => <input id={id} type="tel" inputMode="numeric" value={f.phone} onChange={(e) => set("phone", e.target.value)} />}
          </Field>
          <Field label="District" required error={errors.region} hint={regions.length ? undefined : "Add a district under Regions first."}>
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
          <Field label="Employee code">
            {(id) => <input id={id} value={f.employeeCode} onChange={(e) => set("employeeCode", e.target.value)} />}
          </Field>
          <Field label="Email" error={errors.email}>
            {(id) => <input id={id} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />}
          </Field>
          <Field label="Status">
            {(id) => (
              <select id={id} value={f.status} onChange={(e) => set("status", e.target.value)}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            )}
          </Field>
        </div>
        {!editing && (
          <Field label="Password" required error={errors.password} hint="You will see it once more after saving, to share it.">
            {(id) => (
              <div className="input-with-button">
                <input id={id} className="mono" value={f.password} onChange={(e) => set("password", e.target.value)} autoComplete="new-password" />
                <Button icon={<Wand2 size={16} />} onClick={() => set("password", generatePassword())}>
                  New
                </Button>
              </div>
            )}
          </Field>
        )}
        <Field label="Notes">
          {(id) => <textarea id={id} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />}
        </Field>
        {editing && <p className="muted small">Changing the role, mobile number or district signs this person out of every device.</p>}
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  );
}

function ResetPassword({ staff, onClose }: { staff: Staff; onClose: () => void }) {
  const { toast } = useFeedback();
  const [password, setPassword] = useState(() => generatePassword());
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("At least 8 characters.");
    setBusy(true);
    setError("");
    try {
      await adminApi.resetPassword(staff._id, password);
      setResult(password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (result)
    return (
      <Modal title="Password reset" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <p>
          <strong>{staff.name}</strong> was signed out everywhere. Share the new password with them:
        </p>
        <div className="credentials">
          <div>
            <span className="muted">Mobile number</span>
            <strong>{staff.phone}</strong>
          </div>
          <div>
            <span className="muted">New password</span>
            <strong className="mono">{result}</strong>
          </div>
        </div>
        <Button icon={<Copy size={16} />} onClick={() => copy(`Mobile: ${staff.phone}\nPassword: ${result}`, toast)}>
          Copy details
        </Button>
      </Modal>
    );

  return (
    <Modal
      title={`Reset password — ${staff.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="reset-form" busy={busy}>
            Reset password
          </Button>
        </>
      }
    >
      <form id="reset-form" className="form" onSubmit={submit}>
        <Field label="New password" error={error} hint="They are signed out of every device and must use this password next time.">
          {(id) => (
            <div className="input-with-button">
              <input id={id} className="mono" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus />
              <Button icon={<Wand2 size={16} />} onClick={() => setPassword(generatePassword())}>
                New
              </Button>
            </div>
          )}
        </Field>
      </form>
    </Modal>
  );
}
