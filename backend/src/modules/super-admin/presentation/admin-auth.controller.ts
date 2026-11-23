import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser, type AuthenticatedUser } from "../../../common/decorators/current-user.decorator";
import { Public } from "../../../common/decorators/public.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { AdminAuthService } from "../application/admin-auth.service";
import { SUPER_ADMIN_ROLE } from "../domain/super-admin.constants";
import { AdminLoginDto, ChangeAdminPasswordDto } from "./dtos/admin-auth.dto";

/** Super Admin console sign-in. Use the token as `Authorization: Bearer <token>` on /api/lead-collection/admin/*. */
@ApiTags("Super Admin")
@Controller("auth")
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 900_000 } })
  async login(@Body() dto: AdminLoginDto) {
    return { success: true, data: await this.auth.login(dto) };
  }

  @ApiBearerAuth()
  @Roles(SUPER_ADMIN_ROLE)
  @Get("me")
  async me(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.auth.me(user.id) };
  }

  @ApiBearerAuth()
  @Roles(SUPER_ADMIN_ROLE)
  @Post("change-password")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  async changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangeAdminPasswordDto) {
    return { success: true, data: await this.auth.changePassword(user.id, dto) };
  }
}
