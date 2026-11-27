/** Who is calling: the signed-in Eco Sor user (or a company Super Admin acting as the `admin` role). */
export interface Principal {
  /** lead_users.id: valid in every actor / created_by column. For a Super Admin it is the admin's id. */
  id: string;
  kind: "user" | "admin";
  companyId: string;
  role: string;
  roleId: string | null;
  name: string;
  email: string;
  phone: string;
  permissions: string[];
  employeeId: string | null;
  distributorId: string | null;
  customerId: string | null;
  ip?: string;
}

export interface EcoTokenPayload {
  sub: string;
  scope: "eco";
  role: string;
  /** lead_users.token_version: bumping it (logout, password change, deactivation) ends every session. */
  tv: number;
}

export const ECO_TOKEN_SCOPE = "eco";

export const can = (principal: Principal, permission: string): boolean =>
  principal.permissions.includes("*") || principal.permissions.includes(permission);

export const hasRole = (principal: Principal, ...roles: string[]): boolean => roles.includes(principal.role);

/** Roles that see every record of the company in sales/purchase lists, not just their own. */
export const isManagerRole = (principal: Principal): boolean => ["admin", "sales_manager", "support_manager", "hr"].includes(principal.role);
