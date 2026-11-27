import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from "class-validator";
import { IsEntityId } from "../../../common/decorators/is-entity-id.decorator";
import { PageQueryDto } from "../../../common/eco/pagination";
import { IsDay, Trim } from "../../../common/eco/params";
import { PAYMENT_METHODS } from "../application/payments.service";

/** Fields sent with the proof image (multipart/form-data). */
export class PaymentProofDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) amount!: number;
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value)) @IsIn([...PAYMENT_METHODS]) method!: string;
  @IsDay() paymentDate!: string;
  /** Transaction ID / UTR as printed on the receipt. */
  @Trim() @IsString() @IsNotEmpty() @MaxLength(60) utr!: string;
}

export class VerifyPaymentDto {
  @Trim() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class RejectPaymentDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class PaymentQueueQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(["pending", "verified", "rejected", "duplicate"]) status?: "pending" | "verified" | "rejected" | "duplicate";
  @IsOptional() @IsEntityId() distributorId?: string;
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
  /** true: include replaced (older) submissions too. */
  @IsOptional() @Transform(({ value }) => value === true || value === "true") @IsBoolean() includeHistory?: boolean;
}
