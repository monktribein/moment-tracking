import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { type Db, SqlService } from "../../../database/sql/sql.service";
import { ALL_PERMISSIONS, DEFAULT_GRANTS, ECO_ROLES, GRANTS_VERSION, PERMISSIONS, ROLE_DEFS } from "../domain/rbac.constants";
import type { Principal } from "../domain/principal";

const USER_SQL = `
  SELECT u.id, u.company_id, u.name, u.phone, u.email, u.status, u.is_active, u.token_version, u.password_hash, u.role_id,
         r.code AS role_code, r.name AS role_name, r.is_active AS role_active,
         c.status AS company_status, c.name AS company_name,
         e.id AS employee_id, e.is_active AS employee_active,
         d.id AS distributor_id, d.is_active AS distributor_active, d.portal_access,
         cu.id AS customer_id, cu.mobile_verified, cu.name AS customer_name
    FROM leads.lead_users u
    LEFT JOIN leads.roles r ON r.id = u.role_id
    LEFT JOIN leads.companies c ON c.id = u.company_id
    LEFT JOIN leads.employees e ON e.user_id = u.id
    LEFT JOIN leads.distributors d ON d.user_id = u.id
    LEFT JOIN leads.customers cu ON cu.user_id = u.id`;

export interface UserRow {
  id: string;
  companyId: string;
  name: string;
  phone: string;
  email: string;
  status: string;
  isActive: boolean;
  tokenVersion: number;
  passwordHash: string;
  roleId: string | null;
  roleCode: string | null;
  roleName: string | null;
  roleActive: boolean | null;
  companyStatus: string | null;
  companyName: string | null;
  employeeId: string | null;
  employeeActive: boolean | null;
  distributorId: string | null;
  distributorActive: boolean | null;
  portalAccess: boolean | null;
  customerId: string | null;
  mobileVerified: boolean | null;
}

/** Why a login or token is refused, or null when the account is in good standing. */
export function inactiveReason(u: UserRow): string | null {
  if (!u.roleId || !u.roleCode) return "This account has no Eco Sor role.";
  if (u.status !== "active" || !u.isActive) return "This account is deactivated. Contact your administrator.";
  if (u.companyStatus !== "active") return "This company is suspended.";
  if (u.roleActive === false) return "This role is disabled.";
  if (u.roleCode === "distributor" && !(u.distributorId && u.distributorActive && u.portalAccess)) return "Portal access is not active for this distributor.";
  if (u.roleCode === "customer" && !(u.customerId && u.mobileVerified)) return "Verify your mobile number to sign in.";
  if (!["distributor", "customer"].includes(u.roleCode) && !(u.employeeId && u.employeeActive)) return "This employee account is deactivated.";
  return null;
}

@Injectable()
export class RbacService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RbacService.name);
  private readonly ensured = new Set<string>();
  private readonly shadows = new Set<string>();

  constructor(private readonly sql: SqlService) {}

  /** Makes sure the permission catalogue and every active company's roles exist. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.syncCatalogue();
      const companies = await this.sql.all<{ id: string }>(`SELECT id FROM leads.companies WHERE status = 'active'`);
      for (const c of companies) await this.ensureCompanyRoles(c.id);
    } catch (error) {
      this.logger.error(`RBAC bootstrap failed (is migration 0004 applied?): ${(error as Error).message}`);
    }
  }

  async syncCatalogue(db: Db = this.sql): Promise<void> {
    const codes = Object.keys(PERMISSIONS);
    await db.exec(
      `INSERT INTO leads.permissions (code, module, description)
       SELECT code, split_part(code, '.', 1), description FROM unnest($1::text[], $2::text[]) AS t(code, description)
       ON CONFLICT (code) DO NOTHING`,
      [codes, codes.map((c) => PERMISSIONS[c])],
    );
  }

  /**
   * Creates the nine roles for a company when missing and adds the default grants
   * once per GRANTS_VERSION (never removes or re-adds a grant an admin changed).
   */
  async ensureCompanyRoles(companyId: string): Promise<void> {
    if (this.ensured.has(companyId)) return;
    await this.sql.tx(async (db) => {
      await this.syncCatalogue(db);
      for (const code of ECO_ROLES)
        await db.exec(`INSERT INTO leads.roles (company_id, code, name, description) VALUES ($1, $2, $3, $4) ON CONFLICT (company_id, code) DO NOTHING`, [companyId, code, ROLE_DEFS[code].name, ROLE_DEFS[code].description]);
      const setting = await db.one<{ value: number }>(`SELECT value FROM leads.system_settings WHERE company_id = $1 AND key = 'rbac.grants_version'`, [companyId]);
      if ((Number(setting?.value) || 0) >= GRANTS_VERSION) return;
      await db.exec(
        `INSERT INTO leads.role_permissions (company_id, role_id, permission_id)
         SELECT $1, r.id, p.id FROM leads.roles r JOIN leads.permissions p ON true WHERE r.company_id = $1 AND r.code = 'admin'
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [companyId],
      );
      for (const [role, codes] of Object.entries(DEFAULT_GRANTS))
        await db.exec(
          `INSERT INTO leads.role_permissions (company_id, role_id, permission_id)
           SELECT $1, r.id, p.id FROM leads.roles r JOIN leads.permissions p ON p.code = ANY($3::text[]) WHERE r.company_id = $1 AND r.code = $2
           ON CONFLICT (role_id, permission_id) DO NOTHING`,
          [companyId, role, codes],
        );
      await db.exec(
        `INSERT INTO leads.system_settings (company_id, key, value, description) VALUES ($1, 'rbac.grants_version', $2::jsonb, 'Default role grants applied up to this version')
         ON CONFLICT (company_id, key) DO UPDATE SET value = excluded.value`,
        [companyId, JSON.stringify(GRANTS_VERSION)],
      );
    });
    this.ensured.add(companyId);
  }

  async userRowByLogin(identifier: string): Promise<UserRow[]> {
    const digits = identifier.replace(/\D/g, "");
    const isMobile = !identifier.includes("@") && digits.length >= 10;
    return isMobile
      ? this.sql.all<UserRow>(`${USER_SQL} WHERE u.phone = $1 AND u.role_id IS NOT NULL`, [digits.slice(-10)])
      : this.sql.all<UserRow>(`${USER_SQL} WHERE lower(u.email) = $1 AND u.role_id IS NOT NULL LIMIT 2`, [identifier.trim().toLowerCase()]);
  }

  async userRowById(id: string): Promise<UserRow | null> {
    return this.sql.one<UserRow>(`${USER_SQL} WHERE u.id = $1`, [id]);
  }

  async permissionsOf(roleId: string): Promise<string[]> {
    const rows = await this.sql.all<{ code: string }>(`SELECT p.code FROM leads.role_permissions rp JOIN leads.permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1`, [roleId]);
    return rows.map((r) => r.code);
  }

  async principalFromRow(u: UserRow): Promise<Principal> {
    await this.ensureCompanyRoles(u.companyId);
    return {
      id: u.id,
      kind: "user",
      companyId: u.companyId,
      role: u.roleCode!,
      roleId: u.roleId,
      name: u.customerId && u.roleCode === "customer" ? (u.name ?? "") : u.name,
      email: u.email ?? "",
      phone: u.phone ?? "",
      permissions: await this.permissionsOf(u.roleId!),
      employeeId: u.employeeId,
      distributorId: u.distributorId,
      customerId: u.customerId,
    };
  }

  /**
   * A company Super Admin acting in the Eco Sor API. Foreign keys (approved_by,
   * created_by ...) point at lead_users, so the admin gets an inactive stand-in row with the
   * same id the first time they act. It cannot sign in anywhere.
   */
  async principalForAdmin(admin: { id: string; name: string; email: string; companyId: string }): Promise<Principal> {
    await this.ensureCompanyRoles(admin.companyId);
    const role = await this.sql.one<{ id: string }>(`SELECT id FROM leads.roles WHERE company_id = $1 AND code = 'admin'`, [admin.companyId]);
    if (!this.shadows.has(admin.id)) {
      await this.sql.exec(
        `INSERT INTO leads.lead_users (id, company_id, name, phone, email, password_hash, role, status, created_by_admin_id, created_by_admin_name, role_id, is_active, token_version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, '!', 'admin', 'suspended', $1, $3, $6, false, 0, now(), now()) ON CONFLICT (id) DO NOTHING`,
        [admin.id, admin.companyId, admin.name, `admin-${admin.id}`, admin.email, role?.id ?? null],
      );
      this.shadows.add(admin.id);
    }
    return {
      id: admin.id,
      kind: "admin",
      companyId: admin.companyId,
      role: "admin",
      roleId: role?.id ?? null,
      name: admin.name,
      email: admin.email,
      phone: "",
      permissions: [ALL_PERMISSIONS],
      employeeId: null,
      distributorId: null,
      customerId: null,
    };
  }
}
