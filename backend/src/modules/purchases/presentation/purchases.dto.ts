import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { IsEntityId } from "../../../common/decorators/is-entity-id.decorator";
import { PageQueryDto } from "../../../common/eco/pagination";
import { IsDay, Trim } from "../../../common/eco/params";
import { PURCHASE_STATUSES } from "../domain/purchase-state";

export class ItemDto {
  @IsEntityId() productId!: string;
  /** A positive whole number. */
  @Type(() => Number) @IsInt({ message: "quantity must be a whole number" }) @Min(1) @Max(100000) quantity!: number;
  @Trim() @IsOptional() @IsString() @MaxLength(300) remarks?: string;
}

export class CreatePurchaseDto {
  /** Employees choose an authorized distributor; a distributor login ignores nothing here: any other value is refused. */
  @IsOptional() @IsEntityId() distributorId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ItemDto) items!: ItemDto[];
  @Trim() @IsOptional() @IsString() @MaxLength(1000) remarks?: string;
  /** Employees only: web (office) or android (field sales app). Distributors are always "portal". */
  @IsOptional() @IsIn(["web", "android"]) source?: "web" | "android";
}

export class UpdateDraftDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ItemDto) items?: ItemDto[];
  @Trim() @IsOptional() @IsString() @MaxLength(1000) remarks?: string;
}

export class ReasonDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class OptionalReasonDto {
  @Trim() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ProcessDto {
  @Trim() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) externalInvoiceRef?: string;
}

export class PurchaseQueryDto extends PageQueryDto {
  @IsOptional() @IsIn([...PURCHASE_STATUSES]) status?: string;
  @IsOptional() @IsIn(["pending", "verified", "rejected"]) paymentStatus?: string;
  @IsOptional() @IsIn(["web", "android", "portal"]) source?: string;
  @IsOptional() @IsEntityId() distributorId?: string;
  @IsOptional() @IsEntityId() creatorId?: string;
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
}
