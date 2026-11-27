import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { IsEntityId } from "../../../common/decorators/is-entity-id.decorator";
import { PageQueryDto } from "../../../common/eco/pagination";
import { IsDay, Trim } from "../../../common/eco/params";
import { PASSWORD_RULES } from "../../rbac/presentation/auth.dto";
import { COMPLAINT_CATEGORIES, COMPLAINT_STATUSES } from "../domain/complaint-state";

export class RegisterCustomerDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(20) mobile!: string;
  @IsString() @MinLength(PASSWORD_RULES.min) @MaxLength(PASSWORD_RULES.max) password!: string;
  @Trim() @IsOptional() @IsEmail() @MaxLength(120) email?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(300) address?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(80) city?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(80) state?: string;
  @Trim() @IsOptional() @Matches(/^\d{6}$/, { message: "pin must be 6 digits" }) pin?: string;
  /** Which company's customer app this is. Optional when the platform has a single company or CUSTOMER_COMPANY_ID is set. */
  @IsOptional() @IsEntityId() companyId?: string;
}

export class VerifyMobileDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(20) mobile!: string;
  @Trim() @Matches(/^\d{4,8}$/, { message: "code must be the digits you received" }) otp!: string;
}

export class CustomerProductDto {
  @IsIn(["inverter", "battery"]) category!: "inverter" | "battery";
  @Trim() @IsString() @IsNotEmpty() @MaxLength(80) model!: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(80) serialNo!: string;
  @IsOptional() @IsDay() purchaseDate?: string;
  @IsOptional() @IsEntityId() distributorId?: string;
  /** Key from POST /uploads (scope "warranty"): warranty card or purchase proof. */
  @Trim() @IsOptional() @IsString() @MaxLength(300) proofKey?: string;
}

export class WarrantyReviewDto {
  @IsIn(["eligible", "not_eligible"]) status!: "eligible" | "not_eligible";
  @Trim() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class CreateComplaintDto {
  @IsEntityId() customerProductId!: string;
  @IsIn([...COMPLAINT_CATEGORIES]) category!: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(2000) description!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(300, { each: true }) photos?: string[];
  @Trim() @IsOptional() @IsString() @MaxLength(300) warrantyProofKey?: string;
  /** Defaults to the address on the customer's profile. */
  @Trim() @IsOptional() @IsString() @MaxLength(300) serviceAddress?: string;
  /** Defaults to the customer's mobile. */
  @Trim() @IsOptional() @IsString() @MaxLength(40) contact?: string;
}

export class CustomerQueryDto extends PageQueryDto {}

export class CustomerProductQueryDto extends PageQueryDto {
  @IsOptional() @IsEntityId() customerId?: string;
  @IsOptional() @IsIn(["inverter", "battery"]) category?: string;
  @IsOptional() @IsIn(["pending", "eligible", "not_eligible"]) warrantyStatus?: string;
}

export class ComplaintQueryDto extends PageQueryDto {
  @IsOptional() @IsIn([...COMPLAINT_STATUSES]) status?: string;
  @IsOptional() @IsIn([...COMPLAINT_CATEGORIES]) category?: string;
  @IsOptional() @IsEntityId() customerId?: string;
  @IsOptional() @IsEntityId() engineerId?: string;
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
  /** Engineer app "Today" tab: jobs whose visit is scheduled for this day. */
  @IsOptional() @IsDay() scheduledDate?: string;
}
