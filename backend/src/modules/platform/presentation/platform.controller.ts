import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, type AuthenticatedUser } from "../../../common/decorators/current-user.decorator";
import { Roles } from "../../../common/decorators/roles.decorator";
import { PLATFORM_OWNER_ROLE } from "../../super-admin/domain/super-admin.constants";
import { PlatformService } from "../application/platform.service";
import {
  CompanyQueryDto,
  CreateCompanyAdminDto,
  CreateCompanyDto,
  ResetCompanyAdminPasswordDto,
  UpdateCompanyAdminDto,
  UpdateCompanyDto,
} from "./dtos/platform.dto";

/**
 * The platform owner (higher authority): creates companies and their Super
 * Admin accounts. Sign in at POST /api/auth/login with the platform owner's
 * email; Super Admin tokens are refused here (403).
 */
@ApiTags("Platform Owner")
@ApiBearerAuth()
@Roles(PLATFORM_OWNER_ROLE)
@Controller("platform")
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get("companies")
  async list(@Query() query: CompanyQueryDto) {
    return { success: true, data: await this.platform.listCompanies(query) };
  }

  /** A company and its first Super Admin. Without `adminPassword` a temporary one is returned once. */
  @Post("companies")
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCompanyDto) {
    return {
      success: true,
      message: "Company and Super Admin account created",
      data: await this.platform.createCompany(dto, { id: user.id, name: user.name }),
    };
  }

  @Get("companies/:id")
  async one(@Param("id") id: string) {
    return { success: true, data: await this.platform.getCompany(id) };
  }

  @Put("companies/:id")
  async update(@Param("id") id: string, @Body() dto: UpdateCompanyDto) {
    return {
      success: true,
      message: dto.status === "suspended" ? "Company suspended. Its admins and staff were signed out." : "Company updated",
      data: await this.platform.updateCompany(id, dto),
    };
  }

  @Post("companies/:id/admins")
  async addAdmin(@Param("id") id: string, @Body() dto: CreateCompanyAdminDto) {
    return {
      success: true,
      message: "Super Admin account created",
      data: await this.platform.addAdmin(id, dto),
    };
  }

  @Put("admins/:adminId")
  async updateAdmin(@Param("adminId") adminId: string, @Body() dto: UpdateCompanyAdminDto) {
    return { success: true, message: "Super Admin updated", data: await this.platform.updateAdmin(adminId, dto) };
  }

  @Post("admins/:adminId/reset-password")
  @HttpCode(200)
  async resetAdminPassword(@Param("adminId") adminId: string, @Body() dto: ResetCompanyAdminPasswordDto) {
    return {
      success: true,
      message: "Password reset. The Super Admin's existing sessions were signed out.",
      data: await this.platform.resetAdminPassword(adminId, dto),
    };
  }
}
