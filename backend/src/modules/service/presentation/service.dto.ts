import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";
import { IsEntityId } from "../../../common/decorators/is-entity-id.decorator";
import { IsDay, Trim } from "../../../common/eco/params";

export class AssignDto {
  @IsEntityId() engineerId!: string;
  @IsOptional() @IsDay() scheduledDate?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class ReassignDto extends AssignDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(300) reason!: string;
}

export class ServiceCheckInDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) accuracy?: number;
  @IsOptional() @IsString() timestamp?: string;
}

export class ServiceReportDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(2000) diagnosis!: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(2000) actionTaken!: string;
  @Trim() @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @IsOptional() @IsIn(["en", "hi", "hi-en"]) transcriptLang?: "en" | "hi" | "hi-en";
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(300, { each: true }) photos?: string[];
  /** resolved: the job is done (then request the customer OTP). pending: more work is needed. */
  @IsIn(["resolved", "pending"]) outcome!: "resolved" | "pending";
  @ValidateIf((o: ServiceReportDto) => o.outcome === "pending" || o.furtherAction !== undefined)
  @Trim() @IsString() @IsNotEmpty() @MaxLength(1000) furtherAction?: string;
}

export class VerifyOtpDto {
  @Trim() @Matches(/^\d{4,8}$/, { message: "otp must be the digits the customer received" }) otp!: string;
}

export class ReopenDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}
