export const ADMIN_USER_MODEL = "AdminUser";
export const ADMIN_USER_COLLECTION = "admin_users";

/**
 * The platform owner (the higher authority) creates companies and each
 * company's Super Admin accounts. It sees no company's staff, leads or tracking.
 */
export const PLATFORM_OWNER_ROLE = "platform_owner";
/** Runs one company: manages that company's staff, leads, attendance and tracking only. */
export const SUPER_ADMIN_ROLE = "super_admin";
export const ADMIN_ROLES = [PLATFORM_OWNER_ROLE, SUPER_ADMIN_ROLE] as const;
export const ADMIN_STATUSES = ["active", "suspended"] as const;

/** Admin tokens carry this scope; field-agent tokens carry "lead" and are refused here. */
export const ADMIN_TOKEN_SCOPE = "admin";

export interface AdminTokenPayload {
  sub: string;
  scope: typeof ADMIN_TOKEN_SCOPE;
  role: string;
  /** tokenVersion: bumping it (password change, suspension) signs out every existing session. */
  tv: number;
}

export interface AdminCompanyView {
  id: string;
  name: string;
  status: string;
}

export interface AdminProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  /** The company a Super Admin runs; null for the platform owner. */
  companyId: string | null;
  company: AdminCompanyView | null;
  lastLoginAt: Date | null;
  createdAt?: Date;
}
