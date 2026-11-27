import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { eco } from "../eco/api";
import { Button, ErrorBox, Field, errorText } from "../components/ui";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="eco-wordmark" aria-label="Eco Sor"><span className="eco-bolt" aria-hidden="true">⚡</span>ECO <span className="eco-accent">SOR</span></span>
          <div>
            <h1>{title}</h1>
            <p className="muted">{subtitle}</p>
          </div>
        </div>
        {children}
        <p className="login-foot muted">
          <Link to="/">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}

/** Step 1: send a reset code to the account's WhatsApp number. */
export function ForgotPassword() {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await eco.forgotPassword(identifier.trim());
      navigate(`/reset-password?id=${encodeURIComponent(identifier.trim())}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Forgot password" subtitle="We send a 6-digit code to your WhatsApp number.">
      <form className="form" onSubmit={submit}>
        <Field label="Mobile number or email" required>
          {(id) => <input id={id} value={identifier} onChange={(e) => setIdentifier(e.target.value)} required autoFocus placeholder="10-digit number or email" />}
        </Field>
        {error && <ErrorBox error={error} />}
        <Button type="submit" variant="primary" busy={busy} className="btn-block">
          Send code
        </Button>
      </form>
    </Shell>
  );
}

/** Step 2: the code and a new password. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState(params.get("id") ?? "");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("The new password needs at least 8 characters.");
    if (password !== confirm) return setError("The two passwords do not match.");
    if (!/^\d{6}$/.test(otp)) return setError("Enter the 6-digit code.");
    setBusy(true);
    setError("");
    try {
      await eco.resetPassword(identifier.trim(), otp, password);
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <Shell title="Password changed" subtitle="You were signed out everywhere.">
        <Button variant="primary" className="btn-block" onClick={() => navigate("/", { replace: true })}>
          Sign in with the new password
        </Button>
      </Shell>
    );

  return (
    <Shell title="Set a new password" subtitle="If the account exists, a code was sent to its WhatsApp number. It is valid for 10 minutes.">
      <form className="form" onSubmit={submit}>
        <Field label="Mobile number or email" required>
          {(id) => <input id={id} value={identifier} onChange={(e) => setIdentifier(e.target.value)} required />}
        </Field>
        <Field label="Code" required hint="5 wrong tries lock the code; then request a new one.">
          {(id) => <input id={id} inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} required autoFocus />}
        </Field>
        <Field label="New password" required hint="At least 8 characters.">
          {(id) => <input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}
        </Field>
        <Field label="Repeat new password" required>
          {(id) => <input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
        </Field>
        {error && <ErrorBox error={error} />}
        <Button type="submit" variant="primary" busy={busy} className="btn-block">
          Change password
        </Button>
        <p className="muted small">
          No code? <Link to="/forgot-password">Send another</Link> (at most 3 an hour).
        </p>
      </form>
    </Shell>
  );
}
