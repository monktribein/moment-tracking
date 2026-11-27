import { Body, Get, HttpCode, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { accountRateLimitTracker } from "../../../common/throttling/rate-limit-trackers";
import { ok } from "../../../common/eco/http";
import { EcoAuthService } from "../application/eco-auth.service";
import type { Principal } from "../domain/principal";
import { ChangePasswordDto, EcoLoginDto, ForgotPasswordDto, ResetPasswordDto } from "./auth.dto";
import { Actor, OpenRoute } from "./decorators";
import { EcoController } from "./eco-controller.decorator";

const perAccount = (limit: number) => ({ default: { limit, ttl: 900_000, getTracker: accountRateLimitTracker("identifier") } });

@EcoController("auth", "Eco Sor - Auth")
export class EcoAuthController {
  constructor(private readonly auth: EcoAuthService) {}

  /** Staff, distributors and customers sign in with email or mobile number + password. */
  @Post("login")
  @OpenRoute()
  @HttpCode(200)
  @Throttle(perAccount(10))
  async login(@Body() dto: EcoLoginDto) {
    return ok(await this.auth.login(dto.identifier, dto.password));
  }

  @Get("me")
  async me(@Actor() actor: Principal) {
    return ok(await this.auth.me(actor));
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(@Actor() actor: Principal) {
    return ok(await this.auth.refresh(actor));
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Actor() actor: Principal) {
    await this.auth.logout(actor);
    return ok({ loggedOut: true });
  }

  @Post("change-password")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  async changePassword(@Actor() actor: Principal, @Body() dto: ChangePasswordDto) {
    return ok(await this.auth.changePassword(actor, dto.currentPassword, dto.newPassword));
  }

  @Post("forgot-password")
  @OpenRoute()
  @HttpCode(200)
  @Throttle(perAccount(5))
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.identifier);
    return ok({ message: "If the account exists, a code was sent to its WhatsApp number." });
  }

  @Post("reset-password")
  @OpenRoute()
  @HttpCode(200)
  @Throttle(perAccount(10))
  async reset(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.identifier, dto.otp, dto.newPassword);
    return ok({ message: "Password changed. Sign in with the new password." });
  }
}

