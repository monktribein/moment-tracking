import { Transform } from "class-transformer";
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { IsEntityId } from "../../../common/decorators/is-entity-id.decorator";
import { PageQueryDto } from "../../../common/eco/pagination";
import { Trim } from "../../../common/eco/params";

export class CreateDistributorDto {
  @Trim() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(40) distributorCode?: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(160) firmName!: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(120) contactPerson!: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(20) mobile!: string;
  @Trim() @IsOptional() @IsString() @MaxLength(20) altMobile?: string;
  @Trim() @IsOptional() @IsEmail() @MaxLength(120) email?: string;
  @Trim() @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value)) @IsOptional() @Matches(/^[0-9A-Z]{15}$/, { message: "gstin must be 15 letters/digits" }) gstin?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(300) address?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(80) city?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(80) state?: string;
  @Trim() @IsOptional() @Matches(/^\d{6}$/, { message: "pin must be 6 digits" }) pin?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(500) remarks?: string;
  @IsOptional() @IsEntityId() assignedExecutiveId?: string;
}

export class UpdateDistributorDto {
  @Trim() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) firmName?: string;
  @Trim() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) contactPerson?: string;
  @Trim() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(20) mobile?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(20) altMobile?: string;
  @Trim() @IsOptional() @IsEmail() @MaxLength(120) email?: string;
  @Trim() @Transform(({ value }) => (typeof value === "string" ? value.trim().toUpperCase() : value)) @IsOptional() @Matches(/^[0-9A-Z]{15}$/, { message: "gstin must be 15 letters/digits" }) gstin?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(300) address?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(80) city?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(80) state?: string;
  @Trim() @IsOptional() @Matches(/^\d{6}$/, { message: "pin must be 6 digits" }) pin?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(500) remarks?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AssignExecutiveDto {
  @IsEntityId() employeeId!: string;
  @Trim() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class PortalAccessDto {
  @IsBoolean() enabled!: boolean;
}

export class DistributorQueryDto extends PageQueryDto {
  @IsOptional() @Transform(({ value }) => (value === undefined ? undefined : value === true || value === "true")) @IsBoolean() active?: boolean;
  @IsOptional() @Transform(({ value }) => (value === undefined ? undefined : value === true || value === "true")) @IsBoolean() portal?: boolean;
  @IsOptional() @IsString() @MaxLength(80) state?: string;
  @IsOptional() @IsString() @MaxLength(80) city?: string;
  @IsOptional() @IsEntityId() executiveId?: string;
}

export class ImportQueryDto {
  /** true: validate only, create nothing. */
  @IsOptional() @Transform(({ value }) => value === true || value === "true") @IsBoolean() dryRun?: boolean;
}
