import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, adminApi, getSession, onUnauthorized, setSession, staffApi } from "./api";
import { eco, type EcoUser } from "./eco/api";
import { homeFor } from "./eco/access";
import type { AdminProfile, StaffUser } from "./types";

/** Lead users who may use the web workspace (field agents use the mobile app). */
export const WORKSPACE_ROLES = ["lead_executive", "field_supervisor"];

type AuthState =
  | { status: "loading" }
  | { status: "signedOut"; message?: string }
  | { status: "admin"; admin: AdminProfile }
  | { status: "staff"; user: StaffUser }
  | { status: "eco"; user: EcoUser };

interface AuthContextValue {
  state: AuthState;
  signInAdmin: (email: string, password: string) => Promise<void>;
  signInStaff: (phone: string, password: string) => Promise<void>;
  /**
   * Signs in any account and returns where it should land. Email: console admin first, then an
   * Eco Sor user. Mobile: an Eco Sor user (staff, distributor) first, then a lead executive / supervisor.
   */
  signIn: (mode: "email" | "mobile", identifier: string, password: string) => Promise<string>;
  signOut: (message?: string) => void;
  /** Store a new admin token (after a password change, which signs out other sessions). */
  replaceAdminToken: (token: string, admin: AdminProfile) => void;
  /** Store a new Eco Sor token (after a password change). */
  replaceEcoToken: (token: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** The expiry (ms) written in a JWT, or null. */
function tokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

const unauthorized = (err: unknown) => err instanceof ApiError && err.status === 401;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => (getSession() ? { status: "loading" } : { status: "signedOut" }));

  const signOut = useCallback((message?: string) => {
    if (getSession()?.kind === "eco") eco.logout().catch(() => undefined);
    setSession(null);
    setState({ status: "signedOut", message });
  }, []);

  useEffect(() => {
    onUnauthorized(() => setState({ status: "signedOut", message: "Your session has ended. Please sign in again." }));
    return () => onUnauthorized(null);
  }, []);

  // A stored session is checked with the server before anything is shown.
  useEffect(() => {
    const stored = getSession();
    if (!stored) return;
    const check =
      stored.kind === "admin"
        ? adminApi.me().then((admin) => setState({ status: "admin", admin }))
        : stored.kind === "eco"
          ? eco.me().then((user) => setState({ status: "eco", user }))
          : staffApi.me().then((user) => {
              if (!WORKSPACE_ROLES.includes(user.role)) throw new Error("Not a workspace role");
              setState({ status: "staff", user });
            });
    check.catch(() => signOut());
  }, [signOut]);

  // A session ends at its token's expiry time, even if no request is made meanwhile.
  useEffect(() => {
    if (state.status === "signedOut" || state.status === "loading") return;
    const token = getSession()?.token;
    const exp = token ? tokenExpiry(token) : null;
    if (!exp) return;
    const id = setTimeout(() => signOut("Your session has expired. Please sign in again."), Math.min(2_147_000_000, Math.max(0, exp - Date.now())));
    return () => clearTimeout(id);
  }, [state, signOut]);

  const signInAdmin = useCallback(async (email: string, password: string) => {
    const result = await adminApi.login(email, password);
    setSession({ kind: "admin", token: result.token });
    setState({ status: "admin", admin: result.admin });
  }, []);

  const signInStaff = useCallback(async (phone: string, password: string) => {
    const result = await staffApi.login(phone, password);
    if (!WORKSPACE_ROLES.includes(result.user.role))
      throw new Error("This dashboard is for lead executives and supervisors. Field agents and document verifiers use the mobile app.");
    setSession({ kind: "staff", token: result.token });
    setState({ status: "staff", user: result.user });
  }, []);

  const signInEco = useCallback(async (identifier: string, password: string): Promise<string> => {
    const result = await eco.login(identifier, password);
    if (result.user.role === "customer") throw new Error("Customers use the Eco Sor mobile app.");
    if (result.user.role === "field_support") throw new Error("Field engineers use the Eco Sor mobile app.");
    setSession({ kind: "eco", token: result.token });
    setState({ status: "eco", user: result.user });
    return homeFor(result.user.role);
  }, []);

  const signIn = useCallback(
    async (mode: "email" | "mobile", identifier: string, password: string): Promise<string> => {
      if (mode === "email") {
        try {
          const result = await adminApi.login(identifier, password);
          setSession({ kind: "admin", token: result.token });
          setState({ status: "admin", admin: result.admin });
          return result.admin.role === "platform_owner" ? "/" : "/eco";
        } catch (err) {
          if (!unauthorized(err)) throw err;
          try {
            return await signInEco(identifier, password);
          } catch (ecoErr) {
            // Unknown everywhere: show the console's message. Known Eco Sor account: show its reason.
            throw unauthorized(ecoErr) && /invalid/i.test((ecoErr as Error).message) ? err : ecoErr;
          }
        }
      }
      try {
        return await signInEco(identifier, password);
      } catch (ecoErr) {
        if (!unauthorized(ecoErr)) throw ecoErr;
        try {
          await signInStaff(identifier, password);
          return "/";
        } catch (leadErr) {
          throw /no Eco Sor role/i.test((ecoErr as Error).message) ? leadErr : ecoErr;
        }
      }
    },
    [signInEco, signInStaff],
  );

  const replaceAdminToken = useCallback((token: string, admin: AdminProfile) => {
    setSession({ kind: "admin", token });
    setState({ status: "admin", admin });
  }, []);

  const replaceEcoToken = useCallback((token: string) => {
    setSession({ kind: "eco", token });
    eco.me().then((user) => setState({ status: "eco", user }));
  }, []);

  const value = useMemo(
    () => ({ state, signInAdmin, signInStaff, signIn, signOut, replaceAdminToken, replaceEcoToken }),
    [state, signInAdmin, signInStaff, signIn, signOut, replaceAdminToken, replaceEcoToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
