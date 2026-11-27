import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { KeyRound, Pencil, Plus, Search, UserCheck, UserX } from "lucide-react";
import { eco, type Row } from "../../eco/api";
import { EMPLOYEE_ROLES, ROLE_NAMES } from "../../eco/access";
import { inDate, inr } from "../../eco/format";
import { DataTable, ReasonModal, StatusBadge, TempPasswordModal, useAction, usePaged } from "../../eco/ui";
import { useViewer } from "../../eco/viewer";
import { Badge, Button, ErrorBox, Field, Modal, PageHeader } from "../../components/ui";
import { useAsync, useDebounced } from "../../hooks";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/**
 * Staff accounts of the company. The Super Admin creates every sub-account here (HR, sales,
 * support ...); HR keeps the HR details (designation, salary, weekly off) up to date.
 */
export default function Employees() {
  const viewer = useViewer();
  const isAdmin = viewer.role === "admin";
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [active, setActive] = useState("");
  const term = useDebounced(search.trim());
  const [editing, setEditing] = useState<Row | "new" | null>(params.get("new") && isAdmin ? "new" : null);
  const [toggling, setToggling] = useState<Row | null>(null);
  const [temp, setTemp] = useState<{ who: string; password: string } | null>(null);
  const { run } = useAction();

  const list = usePaged((page) => eco.employees({ page, limit: 20, search: term, role, active, sort: "name", order: "asc" }), [term, role, active]);
  const managers = useAsync(() => eco.employees({ limit: 100, active: true, sort: "name", order: "asc" }), []);

  const closeEditor = () => {
    setEditing(null);
    if (params.get("new")) setParams({}, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle={isAdmin ? "Create and manage your team's accounts: HR, sales, support and admins. Each signs in with their mobile number." : "Your team's employee records."}
        actions={
          isAdmin && (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing("new")}>
              Add employee
            </Button>
          )
        }
      />
      <div className="card">
        <div className="toolbar">
          <div className="filters">
            <div className="search">
              <Search size={16} />
              <input placeholder="Name, mobile, email, code…" value={search} onChange={(e) => (setSearch(e.target.value), list.setPage(1))} />
            </div>
            <select value={role} onChange={(e) => (setRole(e.target.value), list.setPage(1))} aria-label="Role">
              <option value="">All roles</option>
              {EMPLOYEE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_NAMES[r]}
                </option>
              ))}
            </select>
            <select value={active} onChange={(e) => (setActive(e.target.value), list.setPage(1))} aria-label="Status">
              <option value="">Active and inactive</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        </div>
        <DataTable
          state={list}
          empty={term || role || active ? "No employees match" : "No employees yet"}
          emptyHint={isAdmin && !term ? "Add your first team member with Add employee." : undefined}
          columns={[
            { key: "name", label: "Employee", render: (r) => (<><div className="cell-title">{r.name}</div><div className="cell-sub">{r.employeeCode} · {r.mobile}</div></>) },
            { key: "role", label: "Role", render: (r) => <Badge tone="blue">{ROLE_NAMES[r.role as keyof typeof ROLE_NAMES] ?? r.role}</Badge> },
            { key: "designation", label: "Designation", render: (r) => (<><div>{r.designation || "—"}</div><div className="cell-sub">{r.department}</div></>) },
            { key: "managerName", label: "Manager", render: (r) => r.managerName || "—" },
            { key: "joiningDate", label: "Joined", render: (r) => inDate(r.joiningDate) },
            { key: "fixedSalary", label: "Salary", className: "num", render: (r) => inr(r.fixedSalary) },
            { key: "isActive", label: "Status", render: (r) => <StatusBadge status={r.isActive ? "active" : "inactive"} /> },
            {
              key: "actions",
              label: "",
              render: (r) => (
                <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" icon={<Pencil size={14} />} onClick={() => setEditing(r)} aria-label="Edit" />
                  {isAdmin && (
                    <>
                      <Button size="sm" icon={r.isActive ? <UserX size={14} /> : <UserCheck size={14} />} onClick={() => setToggling(r)}>
                        {r.isActive ? "Deactivate" : "Activate"}
                      </Button>
                      <Button
                        size="sm"
                        icon={<KeyRound size={14} />}
                        aria-label="Reset password"
                        title="Reset password"
                        onClick={() => run(async () => setTemp({ who: r.name, password: (await eco.resetEmployeePassword(r.id)).temporaryPassword }))}
                      />
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>

      {editing && (
        <EmployeeForm
          employee={editing === "new" ? null : editing}
          managers={(managers.data?.items ?? []).filter((m) => editing === "new" || m.id !== editing.id)}
          canChangeRole={isAdmin}
          onClose={closeEditor}
          onSaved={(result) => {
            closeEditor();
            list.reload(true);
            managers.reload(true);
            if (result.temporaryPassword) setTemp({ who: result.employee.name, password: result.temporaryPassword });
          }}
        />
      )}
      {toggling && (
        <ReasonModal
          title={toggling.isActive ? `Deactivate ${toggling.name}?` : `Activate ${toggling.name}?`}
          message={toggling.isActive ? "They are signed out at once and cannot sign in until activated again." : "They can sign in again with their current password."}
          optional
          danger={toggling.isActive}
          confirmLabel={toggling.isActive ? "Deactivate" : "Activate"}
          onClose={() => setToggling(null)}
          onSubmit={async (reason) => {
            await eco.setEmployeeActive(toggling.id, !toggling.isActive, reason || undefined);
            list.reload(true);
          }}
        />
      )}
      {temp && <TempPasswordModal title="Temporary password" who={temp.who} password={temp.password} onClose={() => setTemp(null)} />}
    </>
  );
}

function EmployeeForm({
  employee,
  managers,
  canChangeRole,
  onClose,
  onSaved,
}: {
  employee: Row | null;
  managers: Row[];
  canChangeRole: boolean;
  onClose: () => void;
  onSaved: (result: { employee: Row; temporaryPassword?: string }) => void;
}) {
  const [f, setF] = useState({
    name: employee?.name ?? "",
    mobile: employee?.mobile ?? "",
    email: employee?.email ?? "",
    roleCode: employee?.role ?? "sales_manager",
    managerId: employee?.managerId ?? "",
    designation: employee?.designation ?? "",
    department: employee?.department ?? "",
    joiningDate: employee?.joiningDate ?? "",
    fixedSalary: employee?.fixedSalary?.toString() ?? "",
    weeklyOff: (employee?.weeklyOff as string[]) ?? ["sunday"],
  });
  const [error, setError] = useState("");
  const { busy, run } = useAction();
  const set = (k: keyof typeof f, v: unknown) => setF((x) => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!/^[6-9]\d{9}$/.test(f.mobile.replace(/\D/g, "").slice(-10))) return setError("Enter a valid 10-digit mobile number.");
    if (f.fixedSalary && !(Number(f.fixedSalary) >= 0)) return setError("Salary must be a positive amount.");
    const body: Row = {
      name: f.name.trim(),
      mobile: f.mobile.trim(),
      ...(f.email.trim() ? { email: f.email.trim() } : {}),
      ...(canChangeRole ? { roleCode: f.roleCode } : {}),
      ...(f.managerId ? { managerId: f.managerId } : {}),
      ...(f.designation.trim() ? { designation: f.designation.trim() } : {}),
      ...(f.department.trim() ? { department: f.department.trim() } : {}),
      ...(f.joiningDate ? { joiningDate: f.joiningDate } : {}),
      ...(f.fixedSalary !== "" ? { fixedSalary: Number(f.fixedSalary) } : {}),
      weeklyOff: f.weeklyOff,
    };
    await run(async () => {
      if (employee) onSaved({ employee: await eco.updateEmployee(employee.id, body) });
      else onSaved(await eco.createEmployee(body));
    }, employee ? "Employee updated" : "Employee account created");
  };

  return (
    <Modal
      title={employee ? `Edit ${employee.name}` : "Add employee"}
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="employee-form" busy={busy}>
            {employee ? "Save" : "Create account"}
          </Button>
        </>
      }
    >
      <form id="employee-form" className="form" onSubmit={submit}>
        <div className="grid-2">
          <Field label="Full name" required>
            {(id) => <input id={id} required maxLength={120} value={f.name} onChange={(e) => set("name", e.target.value)} />}
          </Field>
          <Field label="Mobile number" required hint="They sign in with this number.">
            {(id) => <input id={id} required inputMode="numeric" value={f.mobile} onChange={(e) => set("mobile", e.target.value)} />}
          </Field>
          <Field label="Email">
            {(id) => <input id={id} type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />}
          </Field>
          <Field label="Role" required hint={canChangeRole ? "Decides what they can see and do." : "Only the Super Admin changes roles."}>
            {(id) => (
              <select id={id} value={f.roleCode} disabled={!canChangeRole} onChange={(e) => set("roleCode", e.target.value)}>
                {EMPLOYEE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_NAMES[r]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Reports to">
            {(id) => (
              <select id={id} value={f.managerId} onChange={(e) => set("managerId", e.target.value)}>
                <option value="">— Nobody —</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({ROLE_NAMES[m.role as keyof typeof ROLE_NAMES] ?? m.role})
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Designation">
            {(id) => <input id={id} maxLength={80} value={f.designation} onChange={(e) => set("designation", e.target.value)} />}
          </Field>
          <Field label="Department">
            {(id) => <input id={id} maxLength={80} value={f.department} onChange={(e) => set("department", e.target.value)} />}
          </Field>
          <Field label="Joining date">
            {(id) => <input id={id} type="date" value={f.joiningDate} onChange={(e) => set("joiningDate", e.target.value)} />}
          </Field>
          <Field label="Fixed monthly salary (₹)">
            {(id) => <input id={id} type="number" min={0} step="0.01" value={f.fixedSalary} onChange={(e) => set("fixedSalary", e.target.value)} />}
          </Field>
        </div>
        <Field label="Weekly off">
          {() => (
            <div className="chips">
              {WEEKDAYS.map((d) => (
                <label key={d} className="check">
                  <input type="checkbox" checked={f.weeklyOff.includes(d)} onChange={(e) => set("weeklyOff", e.target.checked ? [...f.weeklyOff, d] : f.weeklyOff.filter((x) => x !== d))} />
                  {d.slice(0, 3).replace(/^\w/, (c) => c.toUpperCase())}
                </label>
              ))}
            </div>
          )}
        </Field>
        {!employee && <p className="muted small">A temporary password is created and shown once. They can change it after signing in.</p>}
        {error && <ErrorBox error={error} />}
      </form>
    </Modal>
  );
}
