import { useState, type FormEvent } from "react";
import { adminApi } from "../../api";
import { useAuth } from "../../auth";
import { Button, ErrorBox, Field, PageHeader, errorText, useFeedback } from "../../components/ui";
import { fmtDateTime } from "../../format";

export default function Account() {
  const { state, replaceAdminToken } = useAuth();
  const { toast } = useFeedback();
  const admin = state.status === "admin" ? state.admin : null;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (next.length < 10) return setError("The new password needs at least 10 characters.");
    if (next !== repeat) return setError("The two new passwords are different.");
    setBusy(true);
    try {
      const session = await adminApi.changePassword(current, next);
      replaceAdminToken(session.token, session.admin);
      setCurrent("");
      setNext("");
      setRepeat("");
      toast("Password changed. Other devices were signed out.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (!admin) return null;
  const owner = admin.role === "platform_owner";
  return (
    <>
      <PageHeader
        title="My account"
        subtitle={owner ? "The platform owner account." : `Super Admin of ${admin.company?.name ?? "your company"}.`}
      />
      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2>Profile</h2>
          </div>
          <dl className="kv">
            <div className="kv-row">
              <dt>Name</dt>
              <dd>{admin.name}</dd>
            </div>
            <div className="kv-row">
              <dt>Email</dt>
              <dd>{admin.email}</dd>
            </div>
            <div className="kv-row">
              <dt>Role</dt>
              <dd>{owner ? "Platform Owner" : "Super Admin"}</dd>
            </div>
            {!owner && (
              <div className="kv-row">
                <dt>Company</dt>
                <dd>{admin.company?.name ?? "—"}</dd>
              </div>
            )}
            <div className="kv-row">
              <dt>Last sign-in</dt>
              <dd>{fmtDateTime(admin.lastLoginAt)}</dd>
            </div>
          </dl>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Change password</h2>
          </div>
          <form className="form" onSubmit={submit}>
            <Field label="Current password">
              {(id) => <input id={id} type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />}
            </Field>
            <Field label="New password" hint="At least 10 characters.">
              {(id) => <input id={id} type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />}
            </Field>
            <Field label="Repeat the new password">
              {(id) => <input id={id} type="password" autoComplete="new-password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} />}
            </Field>
            {error && <ErrorBox error={error} />}
            <Button type="submit" variant="primary" busy={busy}>
              Change password
            </Button>
          </form>
        </section>
      </div>
    </>
  );
}
