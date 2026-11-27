import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { eco, type EcoUser } from "../eco/api";
import { ROLE_NAMES } from "../eco/access";
import { KV, useAction } from "../eco/ui";
import { Button, ErrorBox, Field, PageHeader } from "../components/ui";

/** Profile and password for an Eco Sor user. Changing the password signs out other devices. */
export default function EcoAccount({ user }: { user: EcoUser }) {
  const { replaceEcoToken } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const { busy, run } = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return setError("The new password needs at least 8 characters.");
    if (next !== repeat) return setError("The two new passwords do not match.");
    setError("");
    if (await run(async () => replaceEcoToken((await eco.changePassword(current, next)).token), "Password changed. Other devices were signed out.")) {
      setCurrent("");
      setNext("");
      setRepeat("");
    }
  };

  return (
    <>
      <PageHeader title="My account" />
      <div className="two-col">
        <div className="card">
          <div className="card-head"><h2>Profile</h2></div>
          <KV items={[["Name", user.name], ["Role", ROLE_NAMES[user.role]], ["Mobile", user.phone], ["Email", user.email], ["Company", user.company?.name]]} />
        </div>
        <form className="card form" onSubmit={submit}>
          <div className="card-head"><h2>Change password</h2></div>
          <Field label="Current password" required>{(id) => <input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}</Field>
          <Field label="New password" required hint="At least 8 characters.">{(id) => <input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />}</Field>
          <Field label="Repeat new password" required>{(id) => <input id={id} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />}</Field>
          {error && <ErrorBox error={error} />}
          <Button type="submit" variant="primary" busy={busy}>Change password</Button>
        </form>
      </div>
    </>
  );
}
