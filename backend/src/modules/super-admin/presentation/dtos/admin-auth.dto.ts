import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";

export class AdminLoginDto {
  @IsEmail() @MaxLength(160) email!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
}

export class ChangeAdminPasswordDto {
  @IsString() @MinLength(1) @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(10) @MaxLength(128) newPassword!: string;
}
