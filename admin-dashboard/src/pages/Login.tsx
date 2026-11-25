import { useState, type FormEvent } from "react";
import { Briefcase, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth";
import { Button, ErrorBox, Field, errorText } from "../components/ui";

type Mode = "admin" | "staff";

export default function Login({ message }: { message?: string }) {
  const { signInAdmin, signInStaff } = useAuth();
  const [mode, setMode] = useState<Mode>("admin");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(message ?? "");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "admin") await signInAdmin(email.trim(), password);
      else await signInStaff(phone.trim(), password);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError("");
    setPassword("");
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <img src="/favicon.svg" alt="" width={44} height={44} />
          <div>
            <h1>Movement Tracking</h1>
            <p className="muted">Sign in to the dashboard</p>
          </div>
        </div>

        <div className="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "admin"} className={mode === "admin" ? "active" : ""} onClick={() => switchMode("admin")}>
            <ShieldCheck size={16} /> Super Admin
          </button>
          <button type="button" role="tab" aria-selected={mode === "staff"} className={mode === "staff" ? "active" : ""} onClick={() => switchMode("staff")}>
            <Briefcase size={16} /> Lead executive
          </button>
        </div>

        <form onSubmit={submit} className="form">
          {mode === "admin" ? (
            <Field label="Email">
              {(id) => (
                <input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              )}
            </Field>
          ) : (
            <Field label="Mobile number" hint="The 10-digit number your account was created with.">
              {(id) => (
                <input id={id} type="tel" inputMode="numeric" autoComplete="username" required value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
              )}
            </Field>
          )}
          <Field label="Password">
            {(id) => (
              <input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            )}
          </Field>
          {error && <ErrorBox error={error} />}
          <Button type="submit" variant="primary" busy={busy} className="btn-block">
            Sign in
          </Button>
        </form>
        <p className="login-foot muted">
          {mode === "admin"
            ? "For the Super Admin account."
            : "For lead executives and supervisors. The Super Admin creates these accounts under Staff."}
        </p>
      </div>
    </div>
  );
}
