import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { adminApi, getSession, onUnauthorized, setSession, staffApi } from "./api";
import type { AdminProfile, StaffUser } from "./types";

/** Lead users who may use the web workspace (field agents use the mobile app). */
export const WORKSPACE_ROLES = ["lead_executive", "field_supervisor"];

type AuthState =
  | { status: "loading" }
  | { status: "signedOut"; message?: string }
  | { status: "admin"; admin: AdminProfile }
  | { status: "staff"; user: StaffUser };

interface AuthContextValue {
  state: AuthState;
  signInAdmin: (email: string, password: string) => Promise<void>;
  signInStaff: (phone: string, password: string) => Promise<void>;
  signOut: (message?: string) => void;
  /** Store a new admin token (after a password change, which signs out other sessions). */
  replaceAdminToken: (token: string, admin: AdminProfile) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => (getSession() ? { status: "loading" } : { status: "signedOut" }));

  const signOut = useCallback((message?: string) => {
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
        : staffApi.me().then((user) => {
            if (!WORKSPACE_ROLES.includes(user.role)) throw new Error("Not a workspace role");
            setState({ status: "staff", user });
          });
    check.catch(() => signOut());
  }, [signOut]);

  const signInAdmin = useCallback(async (email: string, password: string) => {
    const result = await adminApi.login(email, password);
    setSession({ kind: "admin", token: result.token });
    setState({ status: "admin", admin: result.admin });
  }, []);

  const signInStaff = useCallback(async (phone: string, password: string) => {
    const result = await staffApi.login(phone, password);
    if (!WORKSPACE_ROLES.includes(result.user.role))
      throw new Error(
        "This dashboard is for lead executives and supervisors. Field agents and document verifiers use the mobile app.",
      );
    setSession({ kind: "staff", token: result.token });
    setState({ status: "staff", user: result.user });
  }, []);

  const replaceAdminToken = useCallback((token: string, admin: AdminProfile) => {
    setSession({ kind: "admin", token });
    setState({ status: "admin", admin });
  }, []);

  const value = useMemo(
    () => ({ state, signInAdmin, signInStaff, signOut, replaceAdminToken }),
    [state, signInAdmin, signInStaff, signOut, replaceAdminToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
