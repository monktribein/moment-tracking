import type { EcoRole, EcoUser } from "./api";

/** Who is using the Eco Sor screens: an Eco user, or a company Super Admin (acts as `admin`). */
export interface Viewer {
  role: EcoRole;
  permissions: string[];
  name: string;
  employeeId: string | null;
  distributorId: string | null;
  isConsoleAdmin: boolean;
}

export const viewerFromEco = (u: EcoUser): Viewer => ({ role: u.role, permissions: u.permissions, name: u.name, employeeId: u.employeeId, distributorId: u.distributorId, isConsoleAdmin: false });

export const SUPER_ADMIN_VIEWER = (name: string): Viewer => ({ role: "admin", permissions: ["*"], name, employeeId: null, distributorId: null, isConsoleAdmin: true });

/** The same rule as the server: admin holds everything; otherwise the permission must be granted. */
export const can = (v: Viewer, ...permissions: string[]): boolean => v.permissions.includes("*") || permissions.some((p) => v.permissions.includes(p));

export const ROLE_NAMES: Record<EcoRole, string> = {
  admin: "Admin",
  sales_manager: "Sales Manager",
  tele_sales: "Tele-Sales",
  field_sales: "Field Sales",
  support_manager: "Support Manager",
  field_support: "Field Support Engineer",
  hr: "HR",
  distributor: "Distributor",
  customer: "Customer",
};

/** Roles a Super Admin creates as employee accounts (distributors get a portal login from their record). */
export const EMPLOYEE_ROLES: EcoRole[] = ["admin", "sales_manager", "tele_sales", "field_sales", "support_manager", "field_support", "hr"];

/** Where each role lands after signing in. */
export function homeFor(role: EcoRole): string {
  switch (role) {
    case "admin":
      return "/eco";
    case "sales_manager":
      return "/sales";
    case "tele_sales":
    case "field_sales":
      return "/sales/my-distributors";
    case "support_manager":
    case "field_support":
      return "/support";
    case "hr":
      return "/hr";
    case "distributor":
      return "/portal";
    default:
      return "/";
  }
}
