export const ADMIN_USER_MODEL = "AdminUser";
export const ADMIN_USER_COLLECTION = "admin_users";

/** The only admin role in Movement Tracking: sees and manages everything. */
export const SUPER_ADMIN_ROLE = "super_admin";
export const ADMIN_ROLES = [SUPER_ADMIN_ROLE] as const;
export const ADMIN_STATUSES = ["active", "suspended"] as const;

/** Admin tokens carry this scope; field-agent tokens carry "lead" and are refused here. */
export const ADMIN_TOKEN_SCOPE = "admin";

export interface AdminTokenPayload {
  sub: string;
  scope: typeof ADMIN_TOKEN_SCOPE;
  role: string;
  /** tokenVersion: bumping it (password change) signs out every existing session. */
  tv: number;
}

export interface AdminProfile {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  lastLoginAt: Date | null;
  createdAt?: Date;
}
