import { Transform } from "class-transformer";
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from "class-validator";

const trim = ({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value);

/** The rule for every new password: 8-72 characters (bcrypt reads at most 72 bytes). */
export const PASSWORD_RULES = { min: 8, max: 72 };

export class EcoLoginDto {
  /** Email address or 10-digit mobile number. */
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) identifier!: string;
  @IsString() @IsNotEmpty() @MaxLength(PASSWORD_RULES.max) password!: string;
}

export class ForgotPasswordDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) identifier!: string;
}

export class ResetPasswordDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) identifier!: string;
  @Transform(trim) @Matches(/^\d{4,8}$/, { message: "code must be the digits you received" }) otp!: string;
  @IsString() @MinLength(PASSWORD_RULES.min) @MaxLength(PASSWORD_RULES.max) newPassword!: string;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(PASSWORD_RULES.max) currentPassword!: string;
  @IsString() @MinLength(PASSWORD_RULES.min) @MaxLength(PASSWORD_RULES.max) newPassword!: string;
}
