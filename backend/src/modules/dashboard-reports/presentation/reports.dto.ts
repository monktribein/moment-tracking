import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { IsEntityId } from "../../../common/decorators/is-entity-id.decorator";
import { PageQueryDto } from "../../../common/eco/pagination";
import { IsDay } from "../../../common/eco/params";

/** Filters shared by all reports; each report uses the ones that make sense for it. */
export class ReportQueryDto extends PageQueryDto {
  /** Which table of the report (sales: visits|calls|followups|distributors, purchases: requests|payments, service: complaints|engineers, hr: attendance|expenses|leaves|payroll). */
  @IsOptional() @IsString() @MaxLength(30) section?: string;
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
  @IsOptional() @IsEntityId() employeeId?: string;
  @IsOptional() @IsEntityId() distributorId?: string;
  /** Purchase requests: the login (user id) that created them. */
  @IsOptional() @IsEntityId() userId?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsIn(["web", "android", "portal"]) source?: string;
  /** Purchase requests: employee-generated or distributor-generated. */
  @IsOptional() @IsIn(["employee", "distributor"]) origin?: string;
  /** csv downloads the filtered report (needs the reports.export permission). */
  @IsOptional() @IsIn(["json", "csv"]) format?: "json" | "csv";
}
