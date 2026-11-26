import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { compare, hash } from "bcryptjs";
import { InjectModel } from "../../../database/orm-nest";
import type { Model } from "../../../database/orm";
import { LEAD_CONNECTION } from "../../lead-collection/domain/lead-collection.constants";
import { COMPANY_MODEL, COMPANY_SUSPENDED_MESSAGE } from "../../platform/domain/platform.constants";
import {
  ADMIN_TOKEN_SCOPE,
  ADMIN_USER_MODEL,
  PLATFORM_OWNER_ROLE,
  SUPER_ADMIN_ROLE,
  type AdminCompanyView,
  type AdminProfile,
  type AdminTokenPayload,
} from "../domain/super-admin.constants";
import type { AdminLoginDto, ChangeAdminPasswordDto } from "../presentation/dtos/admin-auth.dto";

export interface AdminSession {
  token: string;
  expiresIn: string;
  admin: AdminProfile;
}

@Injectable()
export class AdminAuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    @InjectModel(ADMIN_USER_MODEL, LEAD_CONNECTION)
    private readonly admins: Model<any>,
    @InjectModel(COMPANY_MODEL, LEAD_CONNECTION)
    private readonly companies: Model<any>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  static normaliseEmail(value: unknown): string {
    return String(value ?? "").trim().toLowerCase();
  }

  private get rounds(): number {
    return this.config.get<number>("adminBcryptRounds") ?? 12;
  }

  /** The company a Super Admin runs (null for the platform owner, or when it no longer exists). */
  private async companyOf(admin: any): Promise<AdminCompanyView | null> {
    if (!admin?.companyId) return null;
    const company = await this.companies.findById(admin.companyId).select("name status").lean<any>();
    return company ? { id: String(company._id), name: company.name, status: company.status } : null;
  }

  private view(admin: any, company: AdminCompanyView | null): AdminProfile {
    return {
      id: admin._id.toString(),
      name: admin.name,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      companyId: admin.companyId ?? null,
      company,
      lastLoginAt: admin.lastLoginAt ?? null,
      createdAt: admin.createdAt,
    };
  }

  private session(admin: any, company: AdminCompanyView | null): AdminSession {
    const payload: AdminTokenPayload = {
      sub: admin._id.toString(),
      scope: ADMIN_TOKEN_SCOPE,
      role: admin.role,
      tv: admin.tokenVersion ?? 0,
    };
    return {
      token: this.jwt.sign(payload),
      expiresIn: this.config.get<string>("jwtExpiresIn") ?? "12h",
      admin: this.view(admin, company),
    };
  }

  /**
   * Creates the platform owner from PLATFORM_OWNER_EMAIL / PLATFORM_OWNER_PASSWORD
   * when no platform owner exists yet. It never changes an existing account, so
   * editing the .env afterwards does not reset anyone's password. Super Admins
   * are created by the platform owner, one company at a time.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      if (await this.admins.exists({ role: PLATFORM_OWNER_ROLE })) return;
      const email = AdminAuthService.normaliseEmail(this.config.get<string>("platformOwnerEmail"));
      const password = this.config.get<string>("platformOwnerPassword") ?? "";
      if (!email || !password) {
        this.logger.warn(
          "No platform owner exists yet. Set PLATFORM_OWNER_EMAIL and PLATFORM_OWNER_PASSWORD in .env and restart to create one.",
        );
        return;
      }
      if (await this.admins.exists({ email })) {
        this.logger.error(
          `PLATFORM_OWNER_EMAIL (${email}) already belongs to a Super Admin account. Choose a different email for the platform owner.`,
        );
        return;
      }
      await this.admins.create({
        name: this.config.get<string>("platformOwnerName") || "Platform Owner",
        email,
        passwordHash: await hash(password, this.rounds),
        role: PLATFORM_OWNER_ROLE,
        status: "active",
        companyId: null,
      });
      // warn, not log: local runs print only warnings and errors, and this must be seen.
      this.logger.warn(`First start: platform owner account created for ${email}.`);
    } catch (error) {
      // Another instance created it at the same moment.
      if ((error as { code?: number })?.code === 11000) return;
      this.logger.error(`Could not create the platform owner: ${(error as Error).message}`);
    }
  }

  async login(dto: AdminLoginDto): Promise<AdminSession> {
    const email = AdminAuthService.normaliseEmail(dto.email);
    const admin = await this.admins.findOne({ email }).select("+passwordHash").lean<any>();
    const invalid = new UnauthorizedException("Invalid email or password");
    if (!admin) {
      // Same work as a real check, so response time does not reveal which emails exist.
      await hash(dto.password, this.rounds);
      throw invalid;
    }
    if (!admin.passwordHash || !(await compare(dto.password, admin.passwordHash))) throw invalid;
    if (admin.status !== "active")
      throw new UnauthorizedException("This admin account is suspended.");

    let company: AdminCompanyView | null = null;
    if (admin.role === SUPER_ADMIN_ROLE) {
      company = await this.companyOf(admin);
      if (!company) throw new UnauthorizedException("This admin account is not linked to a company.");
      if (company.status !== "active") throw new UnauthorizedException(COMPANY_SUSPENDED_MESSAGE);
    }

    const lastLoginAt = new Date();
    await this.admins.updateOne({ _id: admin._id }, { $set: { lastLoginAt } });
    return this.session({ ...admin, lastLoginAt }, company);
  }

  async me(id: string): Promise<AdminProfile> {
    const admin = await this.admins.findById(id).lean<any>();
    if (!admin) throw new NotFoundException("Admin account not found");
    return this.view(admin, await this.companyOf(admin));
  }

  /** Changes the password and signs out every other session (tokenVersion + 1). Returns a fresh session. */
  async changePassword(id: string, dto: ChangeAdminPasswordDto): Promise<AdminSession> {
    const admin = await this.admins.findById(id).select("+passwordHash").lean<any>();
    if (!admin) throw new UnauthorizedException("Admin account not found");
    if (!admin.passwordHash || !(await compare(dto.currentPassword, admin.passwordHash)))
      throw new BadRequestException("Current password is incorrect");
    if (dto.currentPassword === dto.newPassword)
      throw new BadRequestException("Choose a new password that is different from the current one");

    const updated = await this.admins
      .findOneAndUpdate(
        { _id: admin._id },
        { $set: { passwordHash: await hash(dto.newPassword, this.rounds) }, $inc: { tokenVersion: 1 } },
        { new: true },
      )
      .lean<any>();
    if (!updated) throw new UnauthorizedException("Admin account not found");
    return this.session(updated, await this.companyOf(updated));
  }
}
