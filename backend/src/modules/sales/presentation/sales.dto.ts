import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { IsEntityId } from "../../../common/decorators/is-entity-id.decorator";
import { PageQueryDto } from "../../../common/eco/pagination";
import { IsDay, Trim } from "../../../common/eco/params";

export class CreateVisitDto {
  @IsEntityId() distributorId!: string;
  @IsEntityId() employeeId!: string;
  @IsDay() visitDate!: string;
  @Trim() @IsOptional() @IsString() @MaxLength(300) purpose?: string;
  @IsOptional() @IsIn(["low", "normal", "high", "urgent"]) priority?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(1000) instructions?: string;
}

export class CheckInDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) accuracy?: number;
  /** The phone's clock; used only when within 10 minutes of the server's. */
  @IsOptional() @IsISO8601() timestamp?: string;
}

export class ProductRequirementDto {
  @IsOptional() @IsEntityId() productId?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(160) productName?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) quantity?: number;
  @Trim() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class VisitReportDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(4000) notes!: string;
  @IsOptional() @IsIn(["en", "hi", "hi-en"]) transcriptLang?: "en" | "hi" | "hi-en";
  /** Keys returned by POST /uploads (scope "photo"). */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(300, { each: true }) photos?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ProductRequirementDto) productRequirements?: ProductRequirementDto[];
  @IsOptional() @IsDay() nextFollowupDate?: string;
}

export class ReasonDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;
}

export class RescheduleDto extends ReasonDto {
  @IsDay() visitDate!: string;
  @IsOptional() @IsEntityId() employeeId?: string;
}

export class VisitQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(["scheduled", "checked_in", "report_submitted", "completed", "cancelled", "rescheduled"]) status?: string;
  @IsOptional() @IsEntityId() employeeId?: string;
  @IsOptional() @IsEntityId() distributorId?: string;
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
}

export class CreateFollowupDto {
  @IsEntityId() distributorId!: string;
  @IsIn(["visit", "call", "lead"]) source!: "visit" | "call" | "lead";
  @IsOptional() @IsEntityId() visitId?: string;
  @IsOptional() @IsEntityId() callLogId?: string;
  @IsOptional() @IsEntityId() leadId?: string;
  @IsDay() dueDate!: string;
  @Trim() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  /** Managers may create follow-ups for another employee. */
  @IsOptional() @IsEntityId() employeeId?: string;
}

export class FollowupQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(["pending", "done", "cancelled"]) status?: string;
  @IsOptional() @IsEntityId() employeeId?: string;
  @IsOptional() @IsEntityId() distributorId?: string;
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
  /** true: only pending follow-ups whose due date has passed. */
  @IsOptional() @Transform(({ value }) => value === true || value === "true") overdue?: boolean;
}

export class CreateCallLogDto {
  @IsEntityId() distributorId!: string;
  @IsIn(["in", "out"]) direction!: "in" | "out";
  @Trim() @IsOptional() @IsString() @MaxLength(120) outcome?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsDay() nextFollowupDate?: string;
  @IsOptional() @IsISO8601() calledAt?: string;
  @IsOptional() @IsEntityId() employeeId?: string;
}

export class CallLogQueryDto extends PageQueryDto {
  @IsOptional() @IsEntityId() employeeId?: string;
  @IsOptional() @IsEntityId() distributorId?: string;
  @IsOptional() @IsIn(["in", "out"]) direction?: string;
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
}

