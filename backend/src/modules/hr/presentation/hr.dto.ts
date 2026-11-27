import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsISO8601, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";
import { IsEntityId } from "../../../common/decorators/is-entity-id.decorator";
import { PageQueryDto } from "../../../common/eco/pagination";
import { IsDay, Trim } from "../../../common/eco/params";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// ------------------------------------------------------------- attendance
export class AttendanceMarkDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) accuracy?: number;
  /** office: the approved web process at the office (no GPS needed). field: GPS is required. */
  @IsOptional() @IsIn(["office", "field"]) mode?: "office" | "field";
  @Trim() @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class AttendanceQueryDto extends PageQueryDto {
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
  @IsOptional() @IsEntityId() employeeId?: string;
}

export class AttendanceCorrectionDto {
  @IsEntityId() attendanceId!: string;
  @IsOptional() @IsISO8601() checkInTime?: string;
  @IsOptional() @IsISO8601() checkOutTime?: string;
  @IsOptional() @IsIn(["checked_in", "checked_out", "present", "half_day", "absent"]) status?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(300) notes?: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

// --------------------------------------------------------------- expenses
export class CreateExpenseDto {
  @IsDay() expenseDate!: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(60) category!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10000000) amount!: number;
  @Trim() @IsOptional() @IsString() @MaxLength(500) description?: string;
  /** Key from POST /uploads (scope "receipt"). */
  @Trim() @IsOptional() @IsString() @MaxLength(300) receiptKey?: string;
  @IsOptional() @IsEntityId() visitId?: string;
}

export class ExpenseQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(["submitted", "approved", "rejected", "reimbursed"]) status?: string;
  @IsOptional() @IsEntityId() employeeId?: string;
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
}

export class ExpenseReasonDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class ReimburseDto {
  @Trim() @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

// ----------------------------------------------------------------- leaves
export class CreateLeaveDto {
  @IsDay() fromDate!: string;
  @IsDay() toDate!: string;
  @IsIn(["casual", "sick", "earned", "unpaid", "other"]) leaveType!: string;
  @Trim() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class LeaveQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(["pending", "approved", "rejected", "cancelled"]) status?: string;
  @IsOptional() @IsEntityId() employeeId?: string;
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
}

export class LeaveDecisionDto {
  @Trim() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class LeaveRejectDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(500) note!: string;
}

// --------------------------------------------------------------- holidays
export class HolidayDto {
  @IsDay() holidayDate!: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsOptional() @IsBoolean() isOptional?: boolean;
}

export class UpdateHolidayDto {
  @IsOptional() @IsDay() holidayDate?: string;
  @Trim() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsBoolean() isOptional?: boolean;
}

export class HolidayQueryDto {
  @IsOptional() @Matches(/^\d{4}$/, { message: "year must be 4 digits" }) year?: string;
}

// ---------------------------------------------------------------- payroll
export class GenerateQueryDto {
  @Matches(MONTH, { message: "month must be YYYY-MM" }) month!: string;
}

export class GenerateBodyDto {
  /** Generate for one employee only. */
  @IsOptional() @IsEntityId() employeeId?: string;
}

export class PayrollQueryDto extends PageQueryDto {
  @IsOptional() @Matches(MONTH, { message: "month must be YYYY-MM" }) month?: string;
  @IsOptional() @IsIn(["draft", "approved", "finalized"]) status?: string;
  @IsOptional() @IsEntityId() employeeId?: string;
}

export class AdjustmentDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(-10000000) @Max(10000000) adjustments!: number;
  @ValidateIf((o: AdjustmentDto) => o.adjustments !== 0)
  @Trim() @IsString() @IsNotEmpty() @MaxLength(300) note?: string;
}

export class SettingsDto {
  /** payroll.* keys: calc_days_mode, calc_days_fixed, half_day_enabled, half_day_minutes, absent_unpaid, paid_leave_types. */
  @IsObject() payroll!: Record<string, unknown>;
}

