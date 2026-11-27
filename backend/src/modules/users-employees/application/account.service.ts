import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { hash } from "bcryptjs";
import { generateTemporaryPassword } from "../../../common/auth/temporary-password";
import type { Db } from "../../../database/sql/sql.service";
import { RbacService } from "../../rbac/application/rbac.service";
import { tenDigits } from "../../notifications/application/whatsapp.service";

export const NEW_ID = "substr(replace(gen_random_uuid()::text, '-', ''), 1, 24)";

/** Creates and manages the sign-in rows (lead_users) behind employees, distributors and customers. */
@Injectable()
export class AccountService {
  constructor(private readonly rbac: RbacService) {}

  private get rounds(): number {
    return Number(process.env.ECO_BCRYPT_ROUNDS) > 0 ? Number(process.env.ECO_BCRYPT_ROUNDS) : 10;
  }

  hashPassword(password: string): Promise<string> {
    return hash(password, this.rounds);
  }

  temporaryPassword(): string {
    return generateTemporaryPassword();
  }

  /** The 10-digit mobile used as the sign-in, or a 400. */
  mobile(value: string): string {
    const m = tenDigits(value);
    if (!m) throw new BadRequestException("Enter a valid 10-digit Indian mobile number");
    return m;
  }

  async roleId(db: Db, companyId: string, code: string): Promise<string> {
    await this.rbac.ensureCompanyRoles(companyId);
    const row = await db.one<{ id: string }>(`SELECT id FROM leads.roles WHERE company_id = $1 AND code = $2 AND is_active`, [companyId, code]);
    if (!row) throw new BadRequestException(`Role "${code}" does not exist or is disabled`);
    return row.id;
  }

  /** Inserts a sign-in row; the mobile number must be unused across the platform. */
  async createLogin(
    db: Db,
    input: { companyId: string; name: string; mobile: string; email?: string | null; password: string; roleCode: string; employeeCode?: string; createdBy: { id: string; name: string }; active?: boolean },
  ): Promise<string> {
    const taken = await db.one(`SELECT 1 FROM leads.lead_users WHERE phone = $1`, [input.mobile]);
    if (taken) throw new ConflictException("That mobile number is already registered");
    const roleId = await this.roleId(db, input.companyId, input.roleCode);
    const active = input.active ?? true;
    const row = await db.one<{ id: string }>(
      `INSERT INTO leads.lead_users (id, company_id, name, phone, email, password_hash, role, status, employee_code, created_by_admin_id, created_by_admin_name, role_id, is_active, token_version, region, state, district, notes, created_at, updated_at)
       VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, '', '', '', '', now(), now()) RETURNING id`,
      [input.companyId, input.name, input.mobile, (input.email ?? "").toLowerCase(), await this.hashPassword(input.password), input.roleCode, active ? "active" : "suspended", input.employeeCode ?? "", input.createdBy.id, input.createdBy.name, roleId, active],
    );
    return row!.id;
  }

  /** Activates or deactivates a login and ends its open sessions. */
  async setLoginActive(db: Db, userId: string, active: boolean): Promise<void> {
    await db.exec(`UPDATE leads.lead_users SET is_active = $2, status = $3, token_version = token_version + 1 WHERE id = $1`, [userId, active, active ? "active" : "suspended"]);
  }

  async setPassword(db: Db, userId: string, password: string): Promise<void> {
    await db.exec(`UPDATE leads.lead_users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1`, [userId, await this.hashPassword(password)]);
  }
}
