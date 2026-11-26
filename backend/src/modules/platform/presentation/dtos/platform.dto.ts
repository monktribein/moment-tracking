import { Transform } from "class-transformer";
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from "class-validator";
import { ADMIN_STATUSES } from "../../../super-admin/domain/super-admin.constants";
import { COMPANY_STATUSES } from "../../domain/platform.constants";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

/** A new company together with its first Super Admin account. */
export class CreateCompanyDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) contactPerson?: string;
  /** Optional; "" means none. */
  @IsOptional() @Transform(trim) @ValidateIf((o) => o.contactEmail !== "") @IsEmail() @MaxLength(160) contactEmail?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(20) contactPhone?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) notes?: string;

  /** The company's Super Admin: signs in to the dashboard with this email. */
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) adminName!: string;
  @Transform(trim) @IsEmail() @MaxLength(160) adminEmail!: string;
  /** Leave out to have a strong temporary password generated (returned once). */
  @IsOptional() @IsString() @MinLength(10) @MaxLength(128) adminPassword?: string;
}

export class UpdateCompanyDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name?: string;
  /** "suspended" signs out the company's Super Admins and staff and blocks their sign-in. */
  @IsOptional() @IsIn(COMPANY_STATUSES as unknown as string[]) status?: "active" | "suspended";
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) contactPerson?: string;
  /** Send "" to clear it. */
  @IsOptional() @Transform(trim) @ValidateIf((o) => o.contactEmail !== "") @IsEmail() @MaxLength(160) contactEmail?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(20) contactPhone?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) notes?: string;
}

export class CompanyQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsIn(COMPANY_STATUSES as unknown as string[]) status?: string;
}

/** Another Super Admin for an existing company. */
export class CreateCompanyAdminDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @Transform(trim) @IsEmail() @MaxLength(160) email!: string;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(128) password?: string;
}

export class UpdateCompanyAdminDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @Transform(trim) @IsEmail() @MaxLength(160) email?: string;
  /** "suspended" signs the Super Admin out at once. */
  @IsOptional() @IsIn(ADMIN_STATUSES as unknown as string[]) status?: "active" | "suspended";
}

export class ResetCompanyAdminPasswordDto {
  /** Leave out to have a strong temporary password generated (returned once). */
  @IsOptional() @IsString() @MinLength(10) @MaxLength(128) password?: string;
}
