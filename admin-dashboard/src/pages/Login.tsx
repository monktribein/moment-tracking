import { useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff, Mail, Smartphone } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Button, ErrorBox, Field, errorText } from "../components/ui";

/**
 * One sign-in page for everyone. The way you sign in decides the account:
 * email (platform owner, a company's Super Admin) or mobile number (lead
 * executives, supervisors). After sign-in each sees only their own workspace.
 */
type Mode = "email" | "mobile";

const MODES: Record<Mode, { label: string; icon: ReactNode; who: string }> = {
  email: { label: "Email", icon: <Mail size={16} />, who: "Administrators, and staff who sign in with their email." },
  mobile: { label: "Mobile number", icon: <Smartphone size={16} />, who: "Sales, support, HR, distributors and lead executives: your 10-digit mobile number." },
};

export default function Login({ message }: { message?: string }) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(message ?? "");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const home = await signIn(mode, mode === "email" ? email.trim() : phone.trim(), password);
      navigate(home, { replace: true });
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
          <span className="eco-wordmark" aria-label="Eco Sor"><span className="eco-bolt" aria-hidden="true">⚡</span>ECO <span className="eco-accent">SOR</span></span>
          <div>
            <h1>Sign in</h1>
            <p className="muted">Business Operations &amp; Movement Tracking</p>
          </div>
        </div>

        <div>
          <div className="segmented" role="tablist" aria-label="Sign in with">
            {(Object.keys(MODES) as Mode[]).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? "active" : ""} onClick={() => switchMode(m)}>
                {MODES[m].icon} {MODES[m].label}
              </button>
            ))}
          </div>
          <p className="login-who muted">{MODES[mode].who}</p>
        </div>

        <form onSubmit={submit} className="form">
          {mode === "email" ? (
            <Field label="Email">
              {(id) => (
                <input id={id} type="email" autoComplete="username" placeholder="name@company.com" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              )}
            </Field>
          ) : (
            <Field label="Mobile number">
              {(id) => (
                <input id={id} type="tel" inputMode="numeric" autoComplete="username" placeholder="10-digit number" required value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
              )}
            </Field>
          )}
          <Field label="Password">
            {(id) => (
              <div className="password-input">
                <input
                  id={id}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            )}
          </Field>
          {error && <ErrorBox error={error} />}
          <Button type="submit" variant="primary" busy={busy} className="btn-block">
            Sign in
          </Button>
        </form>
        <p className="login-foot muted">
          <Link to="/forgot-password">Forgot your password?</Link> Staff and distributors get a reset code on WhatsApp. Administrators: ask the platform owner. Field agents, engineers and customers use the mobile app.
        </p>
      </div>
    </div>
  );
}
