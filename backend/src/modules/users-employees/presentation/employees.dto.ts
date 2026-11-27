import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from "class-validator";
import { IsEntityId } from "../../../common/decorators/is-entity-id.decorator";
import { PageQueryDto } from "../../../common/eco/pagination";
import { EMPLOYEE_ROLES } from "../../rbac/domain/rbac.constants";
import { PASSWORD_RULES } from "../../rbac/presentation/auth.dto";

export const DAY = /^\d{4}-\d{2}-\d{2}$/;
const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export class CreateEmployeeDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(20) mobile!: string;
  @IsOptional() @Transform(trim) @IsEmail() @MaxLength(120) email?: string;
  /** Leave out to generate a temporary password (returned once). */
  @IsOptional() @IsString() @MinLength(PASSWORD_RULES.min) @MaxLength(PASSWORD_RULES.max) password?: string;
  @IsIn([...EMPLOYEE_ROLES]) roleCode!: string;
  @IsOptional() @IsEntityId() managerId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(40) employeeCode?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) designation?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) department?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) address?: string;
  @IsOptional() @Matches(DAY, { message: "joiningDate must be YYYY-MM-DD" }) joiningDate?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) fixedSalary?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsIn(WEEKDAYS, { each: true }) weeklyOff?: string[];
}

export class UpdateEmployeeDto {
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(20) mobile?: string;
  @IsOptional() @Transform(trim) @IsEmail() @MaxLength(120) email?: string;
  @IsOptional() @IsIn([...EMPLOYEE_ROLES]) roleCode?: string;
  @IsOptional() @IsEntityId() managerId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) designation?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(80) department?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) address?: string;
  @IsOptional() @Matches(DAY, { message: "joiningDate must be YYYY-MM-DD" }) joiningDate?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) fixedSalary?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsIn(WEEKDAYS, { each: true }) weeklyOff?: string[];
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class EmployeeQueryDto extends PageQueryDto {
  @IsOptional() @IsIn([...EMPLOYEE_ROLES]) role?: string;
  @IsOptional() @Transform(({ value }) => value === true || value === "true") @IsBoolean() active?: boolean;
  @IsOptional() @IsEntityId() managerId?: string;
  @IsOptional() @IsString() @MaxLength(80) department?: string;
}
