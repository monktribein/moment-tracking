import { useMemo, useState, type FormEvent } from "react";
import { Building2, ClipboardList, Copy, KeyRound, Plus, Power, RefreshCw, Search, Settings2, UserPlus, Users } from "lucide-react";
import { platformApi, type CompanyInput } from "../../api";
import { Badge, Button, Drawer, Empty, ErrorBox, Field, Modal, PageHeader, Spinner, StatCard, errorText, useFeedback } from "../../components/ui";
import { fmtDate, fmtDateTime, generatePassword } from "../../format";
import { useAsync } from "../../hooks";
import type { Company, CompanyAdmin, CompanyDetail } from "../../types";

/** Sign-in details to show once (the password is never shown again). */
interface Credentials {
  title: string;
  intro: string;
  company: string;
  name: string;
  email: string;
  password: string;
}

const isEmail = (v: string) => /^\S+@\S+\.\S+$/.test(v.trim());

function CompanyStatus({ status }: { status: string }) {
  return status === "active" ? <Badge tone="green">Active</Badge> : <Badge tone="red">Suspended</Badge>;
}

async function copy(text: string, toast: (t: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  } catch {
    /* clipboard blocked: the text is on screen to copy by hand */
  }
}

export default function Companies() {
  const { toast, confirm } = useFeedback();
  const data = useAsync(() => platformApi.companies(), []);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const companies = data.data ?? [];
  const totals = useMemo(
    () => ({
      active: companies.filter((c) => c.status === "active").length,
      staff: companies.reduce((n, c) => n + c.counts.staff, 0),
      leads: companies.reduce((n, c) => n + c.counts.leads, 0),
    }),
    [companies],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies.filter(
      (c) =>
        (!status || c.status === status) &&
        (!q || [c.name, c.contactPerson, c.contactEmail, c.contactPhone].some((v) => String(v ?? "").toLowerCase().includes(q))),
    );
  }, [companies, search, status]);

  const replace = (next: Company) =>
    data.setData((list = []) => (list.some((c) => c.id === next.id) ? list.map((c) => (c.id === next.id ? next : c)) : [next, ...list]));

  const toggleStatus = async (c: Company) => {
    const suspend = c.status === "active";
    if (
      suspend &&
      !(await confirm({
        title: `Suspend ${c.name}?`,
        message:
          "Its Super Admins and all its staff are signed out at once and cannot sign in until you activate the company again. Nothing is deleted.",
        confirmLabel: "Suspend company",
        danger: true,
      }))
    )
      return;
    setBusy(c.id);
    try {
      replace(await platformApi.updateCompany(c.id, { status: suspend ? "suspended" : "active" }));
      toast(suspend ? `${c.name} suspended` : `${c.name} is active again`);
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Companies"
        subtitle="Each company has its own Super Admin, staff, leads and tracking. Companies never see each other's data."
        actions={
          <>
            <Button icon={<RefreshCw size={16} />} onClick={() => data.reload(true)}>
              Refresh
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              Add company
            </Button>
          </>
        }
      />

      <div className="stat-grid">
        <StatCard label="Companies" value={companies.length} hint={`${totals.active} active`} icon={<Building2 size={20} />} />
        <StatCard label="Staff accounts" value={totals.staff} hint="Across every company" tone="blue" icon={<Users size={20} />} />
        <StatCard label="Leads" value={totals.leads} hint="Across every company" tone="violet" icon={<ClipboardList size={20} />} />
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="toolbar-right">
            <div className="search">
              <Search size={16} />
              <input placeholder="Search company or contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
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
          <Empty icon={<Building2 size={28} />} title={companies.length ? "No company matches" : "No companies yet"}>
            {companies.length ? "Try another search." : "Add your first company with Add company. You create its Super Admin at the same time."}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th className="num">Super Admins</th>
                  <th className="num">Staff</th>
                  <th className="num">Leads</th>
                  <th>Added</th>
                  <th>Status</th>
                  <th className="actions-col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div className="cell-title">{c.name}</div>
                      <div className="cell-sub">{[c.contactPerson, c.contactPhone, c.contactEmail].filter(Boolean).join(" · ") || "—"}</div>
                    </td>
                    <td className="num">{c.counts.superAdmins}</td>
                    <td className="num" title={`${c.counts.activeStaff} active`}>
                      {c.counts.staff}
                    </td>
                    <td className="num">{c.counts.leads}</td>
                    <td className="nowrap">{fmtDate(c.createdAt)}</td>
                    <td>
                      <CompanyStatus status={c.status} />
                    </td>
                    <td className="actions-col">
                      <div className="row-actions">
                        <button type="button" className="icon-btn" title="Manage" aria-label={`Manage ${c.name}`} onClick={() => setOpenId(c.id)}>
                          <Settings2 size={16} />
                        </button>
                        <button
                          type="button"
                          className={`icon-btn${c.status === "active" ? "" : " text-green"}`}
                          title={c.status === "active" ? "Suspend company" : "Activate company"}
                          aria-label={`${c.status === "active" ? "Suspend" : "Activate"} ${c.name}`}
                          onClick={() => toggleStatus(c)}
                          disabled={busy === c.id}
                        >
                          <Power size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <CreateCompany
          onClose={() => setCreating(false)}
          onCreated={(company, admin, password) => {
            setCreating(false);
            replace(company);
            setCredentials({
              title: "Company created",
              intro: `Share these sign-in details with ${admin.name}, the Super Admin of ${company.name}.`,
              company: company.name,
              name: admin.name,
              email: admin.email,
              password,
            });
          }}
        />
      )}

      {openId && (
        <CompanyDrawer
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={replace}
          onCredentials={setCredentials}
        />
      )}

      {credentials && <CredentialsModal credentials={credentials} onClose={() => setCredentials(null)} />}
    </>
  );
}

function CredentialsModal({ credentials: c, onClose }: { credentials: Credentials; onClose: () => void }) {
  const { toast } = useFeedback();
  return (
    <Modal
      title={c.title}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p>{c.intro} The password is not shown again.</p>
      <div className="credentials">
        <div>
          <span className="muted">Signs in at</span>
          <strong>This dashboard, under Admin</strong>
        </div>
        <div>
          <span className="muted">Company</span>
          <strong>{c.company}</strong>
        </div>
        <div>
          <span className="muted">Email</span>
          <strong>{c.email}</strong>
        </div>
        <div>
          <span className="muted">Password</span>
          <strong className="mono">{c.password}</strong>
        </div>
      </div>
      <Button icon={<Copy size={16} />} onClick={() => copy(`Company: ${c.company}\nEmail: ${c.email}\nPassword: ${c.password}`, toast)}>
        Copy details
      </Button>
    </Modal>
  );
}

function PasswordField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <Field label="Password" required error={error} hint="At least 10 characters. They can change it under My account.">
      {(id) => (
        <div className="input-with-button">
          <input id={id} className="mono" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="new-password" />
          <Button onClick={() => onChange(generatePassword(14))}>New</Button>
        </div>
      )}
    </Field>
  );
}

function CreateCompany({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (company: Company, admin: CompanyAdmin, password: string) => void;
}) {
  const [f, setF] = useState({
    name: "",
    contactPerson: "",
    contactPhone: "",
    contactEmail: "",
    notes: "",
    adminName: "",
    adminEmail: "",
    adminPassword: generatePassword(14),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof f, value: string) => setF((s) => ({ ...s, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const next: Record<string, string> = {};
    if (f.name.trim().length < 2) next.name = "Enter the company name.";
    if (f.contactEmail.trim() && !isEmail(f.contactEmail)) next.contactEmail = "Enter a valid email or leave it empty.";
    if (f.adminName.trim().length < 2) next.adminName = "Enter the Super Admin's name.";
    if (!isEmail(f.adminEmail)) next.adminEmail = "Enter the email they will sign in with.";
    if (f.adminPassword.length < 10) next.adminPassword = "At least 10 characters.";
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      const result = await platformApi.createCompany({
        name: f.name.trim(),
        contactPerson: f.contactPerson.trim(),
        contactPhone: f.contactPhone.trim(),
        contactEmail: f.contactEmail.trim(),
        notes: f.notes.trim(),
        adminName: f.adminName.trim(),
        adminEmail: f.adminEmail.trim(),
        adminPassword: f.adminPassword,
      });
      onCreated(result.company, result.admin, f.adminPassword);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add company"
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="company-form" busy={busy}>
            Create company
          </Button>
        </>
      }
    >
      <form id="company-form" className="form" onSubmit={submit} noValidate>
        <h3 className="form-section">Company</h3>
        <Field label="Company name" required error={errors.name}>
          {(id) => <input id={id} value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />}
        </Field>
        <div className="grid-2">
          <Field label="Contact person">
            {(id) => <input id={id} value={f.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} />}
          </Field>
          <Field label="Contact phone">
            {(id) => <input id={id} type="tel" value={f.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />}
          </Field>
        </div>
        <Field label="Contact email" error={errors.contactEmail}>
          {(id) => <input id={id} type="email" value={f.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />}
        </Field>
        <Field label="Notes">
          {(id) => <textarea id={id} rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} />}
        </Field>

        <h3 className="form-section">Super Admin</h3>
        <p className="muted small">
          This person runs the company: they sign in with this email and create the company's staff. They see only this company.
        </p>
        <div className="grid-2">
          <Field label="Name" required error={errors.adminName}>
            {(id) => <input id={id} value={f.adminName} onChange={(e) => set("adminName", e.target.value)} />}
          </Field>
          <Field label="Email" required error={errors.adminEmail}>
            {(id) => <input id={id} type="email" value={f.adminEmail} onChange={(e) => set("adminEmail", e.target.value)} autoComplete="off" />}
          </Field>
        </div>
        <PasswordField value={f.adminPassword} onChange={(v) => set("adminPassword", v)} error={errors.adminPassword} />
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  );
}

function CompanyDrawer({
  id,
  onClose,
  onChanged,
  onCredentials,
}: {
  id: string;
  onClose: () => void;
  onChanged: (company: Company) => void;
  onCredentials: (c: Credentials) => void;
}) {
  const { toast, confirm } = useFeedback();
  const data = useAsync(() => platformApi.company(id), [id]);
  const [form, setForm] = useState<CompanyInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<CompanyAdmin | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const company = data.data;
  const f: CompanyInput = form ?? {
    name: company?.name ?? "",
    contactPerson: company?.contactPerson ?? "",
    contactPhone: company?.contactPhone ?? "",
    contactEmail: company?.contactEmail ?? "",
    notes: company?.notes ?? "",
  };
  const set = (key: keyof CompanyInput, value: string) => setForm({ ...f, [key]: value });

  const setDetail = (next: Company, admins?: CompanyAdmin[]) =>
    data.setData((cur) => ({ ...(cur as CompanyDetail), ...next, admins: admins ?? cur?.admins ?? [] }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!company || !form) return;
    if ((form.name ?? "").trim().length < 2) return toast("Enter the company name.", "error");
    if (form.contactEmail?.trim() && !isEmail(form.contactEmail)) return toast("Enter a valid contact email or leave it empty.", "error");
    setSaving(true);
    try {
      const saved = await platformApi.updateCompany(company.id, {
        name: form.name?.trim(),
        contactPerson: form.contactPerson?.trim(),
        contactPhone: form.contactPhone?.trim(),
        contactEmail: form.contactEmail?.trim(),
        notes: form.notes?.trim(),
      });
      setDetail(saved);
      onChanged(saved);
      setForm(null);
      toast("Company saved");
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const toggleAdmin = async (a: CompanyAdmin) => {
    const suspend = a.status === "active";
    if (
      suspend &&
      !(await confirm({
        title: `Suspend ${a.name}?`,
        message: "They are signed out at once and cannot sign in until you activate the account again.",
        confirmLabel: "Suspend",
        danger: true,
      }))
    )
      return;
    setBusy(a.id);
    try {
      const saved = await platformApi.updateAdmin(a.id, { status: suspend ? "suspended" : "active" });
      data.setData((cur) => ({ ...(cur as CompanyDetail), admins: (cur?.admins ?? []).map((x) => (x.id === saved.id ? saved : x)) }));
      toast(suspend ? `${a.name} suspended` : `${a.name} is active again`);
    } catch (err) {
      toast(errorText(err), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer
      title={company?.name ?? "Company"}
      subtitle={company ? <CompanyStatus status={company.status} /> : undefined}
      onClose={onClose}
    >
      {data.error ? (
        <ErrorBox error={data.error} onRetry={() => data.reload()} />
      ) : !company ? (
        <Spinner />
      ) : (
        <>
          <section className="card">
            <div className="card-head">
              <h2>Super Admins</h2>
              <Button size="sm" icon={<UserPlus size={16} />} onClick={() => setAdding(true)}>
                Add Super Admin
              </Button>
            </div>
            <ul className="list">
              {company.admins.map((a) => (
                <li key={a.id} className="list-row">
                  <div className="list-main">
                    <div className="cell-title">
                      {a.name} {a.status !== "active" && <Badge tone="red">Suspended</Badge>}
                    </div>
                    <div className="cell-sub">
                      {a.email} · {a.lastLoginAt ? `last sign-in ${fmtDateTime(a.lastLoginAt)}` : "never signed in"}
                    </div>
                  </div>
                  <div className="row-actions">
                    <button type="button" className="icon-btn" title="Reset password" aria-label={`Reset password of ${a.name}`} onClick={() => setResetting(a)}>
                      <KeyRound size={16} />
                    </button>
                    <button
                      type="button"
                      className={`icon-btn${a.status === "active" ? "" : " text-green"}`}
                      title={a.status === "active" ? "Suspend" : "Activate"}
                      aria-label={`${a.status === "active" ? "Suspend" : "Activate"} ${a.name}`}
                      onClick={() => toggleAdmin(a)}
                      disabled={busy === a.id}
                    >
                      <Power size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Totals</h2>
            </div>
            <dl className="kv">
              <div className="kv-row">
                <dt>Staff accounts</dt>
                <dd>
                  {company.counts.staff} ({company.counts.activeStaff} active)
                </dd>
              </div>
              <div className="kv-row">
                <dt>Leads</dt>
                <dd>{company.counts.leads}</dd>
              </div>
              <div className="kv-row">
                <dt>Added</dt>
                <dd>{fmtDateTime(company.createdAt)}</dd>
              </div>
            </dl>
            <p className="muted small">You see totals only. The company's staff, leads and tracking are visible to its own Super Admins.</p>
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Details</h2>
            </div>
            <form className="form" onSubmit={save}>
              <Field label="Company name" required>
                {(fid) => <input id={fid} value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} />}
              </Field>
              <div className="grid-2">
                <Field label="Contact person">
                  {(fid) => <input id={fid} value={f.contactPerson ?? ""} onChange={(e) => set("contactPerson", e.target.value)} />}
                </Field>
                <Field label="Contact phone">
                  {(fid) => <input id={fid} type="tel" value={f.contactPhone ?? ""} onChange={(e) => set("contactPhone", e.target.value)} />}
                </Field>
              </div>
              <Field label="Contact email">
                {(fid) => <input id={fid} type="email" value={f.contactEmail ?? ""} onChange={(e) => set("contactEmail", e.target.value)} />}
              </Field>
              <Field label="Notes">
                {(fid) => <textarea id={fid} rows={3} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />}
              </Field>
              <Button type="submit" variant="primary" busy={saving} disabled={!form}>
                Save changes
              </Button>
            </form>
          </section>
        </>
      )}

      {adding && company && (
        <AddAdmin
          company={company}
          onClose={() => setAdding(false)}
          onAdded={(admin, password) => {
            setAdding(false);
            const admins = [...company.admins, admin];
            setDetail(company, admins);
            onChanged({ ...company, counts: { ...company.counts, superAdmins: admins.length } });
            onCredentials({
              title: "Super Admin added",
              intro: `Share these sign-in details with ${admin.name}.`,
              company: company.name,
              name: admin.name,
              email: admin.email,
              password,
            });
          }}
        />
      )}

      {resetting && company && (
        <ResetAdminPassword
          admin={resetting}
          onClose={() => setResetting(null)}
          onDone={(password) => {
            const a = resetting;
            setResetting(null);
            onCredentials({
              title: "Password reset",
              intro: `${a.name} was signed out everywhere. Share the new password with them.`,
              company: company.name,
              name: a.name,
              email: a.email,
              password,
            });
          }}
        />
      )}
    </Drawer>
  );
}

function AddAdmin({
  company,
  onClose,
  onAdded,
}: {
  company: Company;
  onClose: () => void;
  onAdded: (admin: CompanyAdmin, password: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => generatePassword(14));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (name.trim().length < 2) return setError("Enter their name.");
    if (!isEmail(email)) return setError("Enter the email they will sign in with.");
    if (password.length < 10) return setError("The password needs at least 10 characters.");
    setBusy(true);
    try {
      const result = await platformApi.addAdmin(company.id, { name: name.trim(), email: email.trim(), password });
      onAdded(result.admin, password);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Add Super Admin — ${company.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-admin-form" busy={busy}>
            Create account
          </Button>
        </>
      }
    >
      <form id="add-admin-form" className="form" onSubmit={submit} noValidate>
        <p className="muted small">They manage the same company's staff and data as its other Super Admins.</p>
        <Field label="Name" required>
          {(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}
        </Field>
        <Field label="Email" required>
          {(id) => <input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}
        </Field>
        <PasswordField value={password} onChange={setPassword} />
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  );
}

function ResetAdminPassword({
  admin,
  onClose,
  onDone,
}: {
  admin: CompanyAdmin;
  onClose: () => void;
  onDone: (password: string) => void;
}) {
  const [password, setPassword] = useState(() => generatePassword(14));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 10) return setError("At least 10 characters.");
    setBusy(true);
    setError("");
    try {
      await platformApi.resetAdminPassword(admin.id, password);
      onDone(password);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Reset password — ${admin.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="reset-admin-form" busy={busy}>
            Reset password
          </Button>
        </>
      }
    >
      <form id="reset-admin-form" className="form" onSubmit={submit}>
        <p className="muted small">They are signed out of every device and must use the new password next time.</p>
        <PasswordField value={password} onChange={setPassword} error={error} />
      </form>
    </Modal>
  );
}
