import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { compare, hash } from "bcryptjs";
import { SqlService } from "../../../database/sql/sql.service";
import { AuditService } from "../../audit/application/audit.service";
import { ECO_TOKEN_SCOPE, type EcoTokenPayload, type Principal } from "../domain/principal";
import { inactiveReason, RbacService, type UserRow } from "./rbac.service";
import { MobileOtpService } from "./mobile-otp.service";
import { tenDigits } from "../../notifications/application/whatsapp.service";

const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.2LzvJFuG7cJ5SvQ2m5r7L1Z8d1mK";

export interface EcoSession {
  token: string;
  expiresIn: string;
  user: ReturnType<EcoAuthService["profile"]>;
}

@Injectable()
export class EcoAuthService {
  constructor(
    private readonly sql: SqlService,
    private readonly rbac: RbacService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly otp: MobileOtpService,
  ) {}

  private get rounds(): number {
    return Number(process.env.ECO_BCRYPT_ROUNDS) > 0 ? Number(process.env.ECO_BCRYPT_ROUNDS) : 10;
  }

  /** Session lifetime: ECO_JWT_EXPIRES_IN (default 8h). After it the token is refused and the user signs in again. */
  get expiresIn(): string {
    return process.env.ECO_JWT_EXPIRES_IN || "8h";
  }

  profile(p: Principal, company?: { id: string; name: string } | null) {
    return {
      id: p.id,
      kind: p.kind,
      name: p.name,
      email: p.email,
      phone: p.phone,
      role: p.role,
      permissions: p.permissions,
      companyId: p.companyId,
      company: company ?? null,
      employeeId: p.employeeId,
      distributorId: p.distributorId,
      customerId: p.customerId,
    };
  }

  private async companyOf(p: Principal) {
    return this.sql.one<{ id: string; name: string }>(`SELECT id, name FROM leads.companies WHERE id = $1`, [p.companyId]);
  }

  private sign(user: { id: string; role: string; tokenVersion: number }): string {
    const payload: EcoTokenPayload = { sub: user.id, scope: ECO_TOKEN_SCOPE, role: user.role, tv: user.tokenVersion ?? 0 };
    return this.jwt.sign(payload, { expiresIn: this.expiresIn as never });
  }

  async login(identifier: string, password: string): Promise<EcoSession> {
    const invalid = new UnauthorizedException("Invalid email, mobile number or password");
    const matches = await this.rbac.userRowByLogin(identifier);
    if (matches.length > 1) throw new UnauthorizedException("More than one account uses this email. Sign in with your mobile number.");
    const user = matches[0];
    if (!user) {
      await compare(password, DUMMY_HASH);
      throw invalid;
    }
    if (!user.passwordHash || !(await compare(password, user.passwordHash))) throw invalid;
    const reason = inactiveReason(user);
    if (reason) throw new UnauthorizedException(reason);
    await this.sql.exec(`UPDATE leads.lead_users SET last_login_at = now() WHERE id = $1`, [user.id]);
    const principal = await this.rbac.principalFromRow(user);
    await this.audit.logQuietly(principal, "auth.login", "user", user.id, null, { role: principal.role });
    return { token: this.sign({ id: user.id, role: principal.role, tokenVersion: user.tokenVersion }), expiresIn: this.expiresIn, user: this.profile(principal, await this.companyOf(principal)) };
  }

  /** Resolves a bearer token to the caller. Console (Super Admin) tokens act as the company `admin`. */
  async verifyToken(token: string): Promise<Principal> {
    const expired = new UnauthorizedException("Session expired. Please sign in again.");
    let payload: { sub?: string; scope?: string; tv?: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw expired;
    }
    if (!payload.sub) throw expired;
    if (payload.scope === ECO_TOKEN_SCOPE) {
      const user = await this.rbac.userRowById(payload.sub);
      if (!user) throw expired;
      if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) throw expired;
      const reason = inactiveReason(user);
      if (reason) throw new UnauthorizedException(reason);
      return this.rbac.principalFromRow(user);
    }
    if (payload.scope === "admin") {
      const admin = await this.sql.one<{ id: string; name: string; email: string; role: string; status: string; tokenVersion: number; companyId: string | null; companyStatus: string | null }>(
        `SELECT a.id, a.name, a.email, a.role, a.status, a.token_version, a.company_id, c.status AS company_status FROM leads.admin_users a LEFT JOIN leads.companies c ON c.id = a.company_id WHERE a.id = $1`,
        [payload.sub],
      );
      if (!admin || admin.role !== "super_admin" || !admin.companyId) throw new UnauthorizedException("This token cannot use the Eco Sor API");
      if ((payload.tv ?? 0) !== (admin.tokenVersion ?? 0)) throw expired;
      if (admin.status !== "active" || admin.companyStatus !== "active") throw new UnauthorizedException("This account is suspended.");
      return this.rbac.principalForAdmin({ id: admin.id, name: admin.name, email: admin.email, companyId: admin.companyId });
    }
    throw new UnauthorizedException("This token is not valid here");
  }

  async me(p: Principal) {
    return this.profile(p, await this.companyOf(p));
  }

  /** A fresh token for a still-valid session (sliding expiry). */
  async refresh(p: Principal): Promise<{ token: string; expiresIn: string }> {
    if (p.kind === "admin") throw new BadRequestException("Console sessions are renewed from the console sign-in.");
    const user = await this.rbac.userRowById(p.id);
    return { token: this.sign({ id: p.id, role: p.role, tokenVersion: user?.tokenVersion ?? 0 }), expiresIn: this.expiresIn };
  }

  /** Ends every session of this user (token version + 1). */
  async logout(p: Principal): Promise<void> {
    if (p.kind === "user") await this.sql.exec(`UPDATE leads.lead_users SET token_version = token_version + 1 WHERE id = $1`, [p.id]);
    await this.audit.logQuietly(p, "auth.logout", "user", p.id);
  }

  async changePassword(p: Principal, currentPassword: string, newPassword: string): Promise<{ token: string; expiresIn: string }> {
    if (p.kind === "admin") throw new BadRequestException("Change a Super Admin password from the console.");
    const user = await this.rbac.userRowById(p.id);
    if (!user?.passwordHash || !(await compare(currentPassword, user.passwordHash))) throw new BadRequestException("Current password is incorrect");
    if (currentPassword === newPassword) throw new BadRequestException("Choose a password different from the current one");
    const row = await this.sql.one<{ tokenVersion: number }>(`UPDATE leads.lead_users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1 RETURNING token_version`, [p.id, await hash(newPassword, this.rounds)]);
    await this.audit.logQuietly(p, "auth.password_changed", "user", p.id);
    return { token: this.sign({ id: p.id, role: p.role, tokenVersion: row!.tokenVersion }), expiresIn: this.expiresIn };
  }

  /** Sends a reset code by WhatsApp. Always answers the same, so it cannot be used to find out who has an account. */
  async forgotPassword(identifier: string): Promise<void> {
    const users = (await this.rbac.userRowByLogin(identifier)).filter((u) => !inactiveReason(u));
    const user = users.length === 1 ? users[0] : null;
    const mobile = tenDigits(user?.phone);
    if (user && mobile) await this.otp.issue(user.companyId, mobile, "reset_password").catch(() => undefined);
  }

  async resetPassword(identifier: string, code: string, newPassword: string): Promise<void> {
    const users = (await this.rbac.userRowByLogin(identifier)).filter((u) => !inactiveReason(u));
    const user: UserRow | undefined = users.length === 1 ? users[0] : undefined;
    const mobile = tenDigits(user?.phone);
    if (!user || !mobile) throw new BadRequestException("The code is incorrect.");
    await this.otp.verify(mobile, "reset_password", code);
    const updated = await this.sql.exec(`UPDATE leads.lead_users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1`, [user.id, await hash(newPassword, this.rounds)]);
    if (!updated) throw new ConflictException("Account not found");
    await this.audit.logQuietly({ id: user.id, role: user.roleCode, companyId: user.companyId }, "auth.password_reset", "user", user.id);
  }
}
