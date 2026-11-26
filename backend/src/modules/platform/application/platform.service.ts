import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { hash } from "bcryptjs";
import { InjectModel } from "../../../database/orm-nest";
import { Types, type Model } from "../../../database/orm";
import { generateTemporaryPassword } from "../../../common/auth/temporary-password";
import { escapeRegex } from "../../../common/utils/escape-regex";
import {
  LEAD_CONNECTION,
  LEAD_MODEL,
  LEAD_USER_MODEL,
} from "../../lead-collection/domain/lead-collection.constants";
import { ADMIN_USER_MODEL, SUPER_ADMIN_ROLE } from "../../super-admin/domain/super-admin.constants";
import { COMPANY_MODEL } from "../domain/platform.constants";
import type {
  CompanyQueryDto,
  CreateCompanyAdminDto,
  CreateCompanyDto,
  ResetCompanyAdminPasswordDto,
  UpdateCompanyAdminDto,
  UpdateCompanyDto,
} from "../presentation/dtos/platform.dto";

export interface PlatformActor {
  id: string;
  name: string;
}

export interface CompanyCounts {
  superAdmins: number;
  staff: number;
  activeStaff: number;
  leads: number;
}

export interface CompanyView {
  id: string;
  name: string;
  status: string;
  contactPerson: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
  createdByAdminName: string;
  createdAt?: Date;
  updatedAt?: Date;
  counts: CompanyCounts;
}

export interface CompanyAdminView {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  companyId: string;
  lastLoginAt: Date | null;
  createdAt?: Date;
}

/**
 * The platform owner's work: companies and each company's Super Admin
 * accounts. It never returns a company's staff, leads or tracking, only counts.
 */
@Injectable()
export class PlatformService {
  constructor(
    @InjectModel(COMPANY_MODEL, LEAD_CONNECTION)
    private readonly companies: Model<any>,
    @InjectModel(ADMIN_USER_MODEL, LEAD_CONNECTION)
    private readonly admins: Model<any>,
    @InjectModel(LEAD_USER_MODEL, LEAD_CONNECTION)
    private readonly staff: Model<any>,
    @InjectModel(LEAD_MODEL, LEAD_CONNECTION)
    private readonly leads: Model<any>,
    private readonly config: ConfigService,
  ) {}

  private get rounds(): number {
    return this.config.get<number>("adminBcryptRounds") ?? 12;
  }

  private static email(value: unknown): string {
    return String(value ?? "").trim().toLowerCase();
  }

  private objectId(id: string, what: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(`${what} not found`);
    return new Types.ObjectId(id);
  }

  private async counts(companyId: string): Promise<CompanyCounts> {
    const [superAdmins, staff, activeStaff, leads] = await Promise.all([
      this.admins.countDocuments({ companyId, role: SUPER_ADMIN_ROLE }),
      this.staff.countDocuments({ companyId }),
      this.staff.countDocuments({ companyId, status: "active" }),
      this.leads.countDocuments({ companyId }),
    ]);
    return { superAdmins, staff, activeStaff, leads };
  }

  private async companyView(row: any): Promise<CompanyView> {
    const id = String(row._id);
    return {
      id,
      name: row.name,
      status: row.status,
      contactPerson: row.contactPerson ?? "",
      contactEmail: row.contactEmail ?? "",
      contactPhone: row.contactPhone ?? "",
      notes: row.notes ?? "",
      createdByAdminName: row.createdByAdminName ?? "",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      counts: await this.counts(id),
    };
  }

  private adminView(row: any): CompanyAdminView {
    return {
      id: String(row._id),
      name: row.name,
      email: row.email,
      role: row.role,
      status: row.status,
      companyId: String(row.companyId ?? ""),
      lastLoginAt: row.lastLoginAt ?? null,
      createdAt: row.createdAt,
    };
  }

  private async companyRow(id: string): Promise<any> {
    const row = await this.companies.findById(this.objectId(id, "Company")).lean<any>();
    if (!row) throw new NotFoundException("Company not found");
    return row;
  }

  /** A Super Admin account (never the platform owner's own). */
  private async adminRow(id: string): Promise<any> {
    const row = await this.admins
      .findOne({ _id: this.objectId(id, "Super Admin"), role: SUPER_ADMIN_ROLE })
      .lean<any>();
    if (!row) throw new NotFoundException("Super Admin not found");
    return row;
  }

  private async assertNameFree(name: string, exceptId?: Types.ObjectId): Promise<void> {
    const filter: Record<string, unknown> = { name: new RegExp(`^${escapeRegex(name.trim())}$`, "i") };
    if (exceptId) filter._id = { $ne: exceptId };
    if (await this.companies.exists(filter))
      throw new ConflictException("A company with this name already exists");
  }

  private async assertEmailFree(email: string, exceptId?: Types.ObjectId): Promise<void> {
    const filter: Record<string, unknown> = { email };
    if (exceptId) filter._id = { $ne: exceptId };
    if (await this.admins.exists(filter))
      throw new ConflictException("An admin account with this email already exists");
  }

  /** Signs out every Super Admin and staff member of a company (their tokenVersion + 1). */
  private async signOutCompany(companyId: string): Promise<void> {
    await Promise.all([
      this.admins.updateMany({ companyId }, { $inc: { tokenVersion: 1 } }),
      this.staff.updateMany({ companyId }, { $inc: { tokenVersion: 1 } }),
    ]);
  }

  // ── Companies ─────────────────────────────────────────────────────────────

  async listCompanies(query: CompanyQueryDto): Promise<CompanyView[]> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.search?.trim()) {
      const term = new RegExp(escapeRegex(query.search.trim()), "i");
      filter.$or = [{ name: term }, { contactPerson: term }, { contactEmail: term }, { contactPhone: term }];
    }
    const rows = await this.companies.find(filter).sort({ createdAt: -1 }).lean<any[]>();
    return Promise.all(rows.map((row) => this.companyView(row)));
  }

  async getCompany(id: string): Promise<CompanyView & { admins: CompanyAdminView[] }> {
    const row = await this.companyRow(id);
    const admins = await this.admins
      .find({ companyId: String(row._id), role: SUPER_ADMIN_ROLE })
      .sort({ createdAt: 1 })
      .lean<any[]>();
    return { ...(await this.companyView(row)), admins: admins.map((a) => this.adminView(a)) };
  }

  /** Creates a company and its first Super Admin. A generated password is returned once. */
  async createCompany(
    dto: CreateCompanyDto,
    actor: PlatformActor,
  ): Promise<{ company: CompanyView; admin: CompanyAdminView; temporaryPassword?: string }> {
    const adminEmail = PlatformService.email(dto.adminEmail);
    await this.assertNameFree(dto.name);
    await this.assertEmailFree(adminEmail);

    const temporaryPassword = dto.adminPassword ? undefined : generateTemporaryPassword();
    const passwordHash = await hash(dto.adminPassword ?? temporaryPassword!, this.rounds);

    const company = await this.companies.create({
      name: dto.name.trim(),
      status: "active",
      contactPerson: dto.contactPerson ?? "",
      contactEmail: dto.contactEmail ?? "",
      contactPhone: dto.contactPhone ?? "",
      notes: dto.notes ?? "",
      createdByAdminId: actor.id,
      createdByAdminName: actor.name,
    });
    let admin: any;
    try {
      admin = await this.admins.create({
        name: dto.adminName.trim(),
        email: adminEmail,
        passwordHash,
        role: SUPER_ADMIN_ROLE,
        status: "active",
        companyId: String(company._id),
      });
    } catch (error) {
      // No company without a Super Admin: undo, then report.
      await this.companies.deleteOne({ _id: company._id }).catch(() => undefined);
      if ((error as { code?: number })?.code === 11000)
        throw new ConflictException("An admin account with this email already exists");
      throw error;
    }

    return {
      company: await this.companyView(company.toObject ? company.toObject() : company),
      admin: this.adminView(admin.toObject ? admin.toObject() : admin),
      ...(temporaryPassword ? { temporaryPassword } : {}),
    };
  }

  /** Renames or edits a company; suspending it signs out its Super Admins and staff at once. */
  async updateCompany(id: string, dto: UpdateCompanyDto): Promise<CompanyView> {
    const existing = await this.companyRow(id);
    const set: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      if (dto.name.trim().toLowerCase() !== String(existing.name).trim().toLowerCase())
        await this.assertNameFree(dto.name, existing._id);
      set.name = dto.name.trim();
    }
    for (const key of ["contactPerson", "contactEmail", "contactPhone", "notes"] as const)
      if (dto[key] !== undefined) set[key] = dto[key];
    if (dto.status !== undefined) set.status = dto.status;
    if (!Object.keys(set).length) throw new BadRequestException("Nothing to update");

    const row = await this.companies
      .findOneAndUpdate({ _id: existing._id }, { $set: set }, { new: true })
      .lean<any>();
    if (!row) throw new NotFoundException("Company not found");
    if (dto.status === "suspended" && existing.status !== "suspended")
      await this.signOutCompany(String(row._id));
    return this.companyView(row);
  }

  // ── A company's Super Admins ─────────────────────────────────────────────

  async addAdmin(
    companyId: string,
    dto: CreateCompanyAdminDto,
  ): Promise<{ admin: CompanyAdminView; temporaryPassword?: string }> {
    const company = await this.companyRow(companyId);
    const email = PlatformService.email(dto.email);
    await this.assertEmailFree(email);
    const temporaryPassword = dto.password ? undefined : generateTemporaryPassword();
    let admin: any;
    try {
      admin = await this.admins.create({
        name: dto.name.trim(),
        email,
        passwordHash: await hash(dto.password ?? temporaryPassword!, this.rounds),
        role: SUPER_ADMIN_ROLE,
        status: "active",
        companyId: String(company._id),
      });
    } catch (error) {
      if ((error as { code?: number })?.code === 11000)
        throw new ConflictException("An admin account with this email already exists");
      throw error;
    }
    return {
      admin: this.adminView(admin.toObject ? admin.toObject() : admin),
      ...(temporaryPassword ? { temporaryPassword } : {}),
    };
  }

  async updateAdmin(adminId: string, dto: UpdateCompanyAdminDto): Promise<CompanyAdminView> {
    const existing = await this.adminRow(adminId);
    const set: Record<string, unknown> = {};
    const inc: Record<string, number> = {};
    if (dto.name !== undefined) set.name = dto.name.trim();
    if (dto.email !== undefined) {
      const email = PlatformService.email(dto.email);
      if (email !== existing.email) {
        await this.assertEmailFree(email, existing._id);
        set.email = email;
      }
    }
    if (dto.status !== undefined) {
      set.status = dto.status;
      if (dto.status === "suspended") inc.tokenVersion = 1;
    }
    if (!Object.keys(set).length) return this.adminView(existing);

    const row = await this.admins
      .findOneAndUpdate(
        { _id: existing._id, role: SUPER_ADMIN_ROLE },
        Object.keys(inc).length ? { $set: set, $inc: inc } : { $set: set },
        { new: true },
      )
      .lean<any>();
    if (!row) throw new NotFoundException("Super Admin not found");
    return this.adminView(row);
  }

  /** New password for a Super Admin; signs out their sessions. A generated password is returned once. */
  async resetAdminPassword(
    adminId: string,
    dto: ResetCompanyAdminPasswordDto,
  ): Promise<{ id: string; temporaryPassword?: string }> {
    const existing = await this.adminRow(adminId);
    const temporaryPassword = dto.password ? undefined : generateTemporaryPassword();
    await this.admins.updateOne(
      { _id: existing._id, role: SUPER_ADMIN_ROLE },
      {
        $set: { passwordHash: await hash(dto.password ?? temporaryPassword!, this.rounds) },
        $inc: { tokenVersion: 1 },
      },
    );
    return { id: String(existing._id), ...(temporaryPassword ? { temporaryPassword } : {}) };
  }
}
