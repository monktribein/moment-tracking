import { Transform } from "class-transformer";
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { PageQueryDto } from "../../../common/eco/pagination";
import { Trim } from "../../../common/eco/params";

export class CreateProductDto {
  @Trim() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(40) productCode?: string;
  @IsIn(["inverter", "battery"]) category!: "inverter" | "battery";
  @Trim() @IsString() @IsNotEmpty() @MaxLength(160) name!: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(80) model!: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(80) sku!: string;
  @Trim() @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class UpdateProductDto {
  @IsOptional() @IsIn(["inverter", "battery"]) category?: "inverter" | "battery";
  @Trim() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(160) name?: string;
  @Trim() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) model?: string;
  @Trim() @IsOptional() @IsString() @IsNotEmpty() @MaxLength(80) sku?: string;
  @Trim() @IsOptional() @IsString() @MaxLength(1000) description?: string;
}

export class SetActiveDto {
  @IsBoolean() isActive!: boolean;
}

export class ProductQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(["inverter", "battery"]) category?: "inverter" | "battery";
  @IsOptional() @Transform(({ value }) => (value === undefined ? undefined : value === true || value === "true")) @IsBoolean() active?: boolean;
}
