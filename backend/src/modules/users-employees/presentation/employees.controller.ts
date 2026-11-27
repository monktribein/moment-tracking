import { Body, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { ok, paged } from "../../../common/eco/http";
import { IdParam } from "../../../common/eco/params";
import type { Principal } from "../../rbac/domain/principal";
import { Actor, Permissions, RequireRoles } from "../../rbac/presentation/decorators";
import { EcoController } from "../../rbac/presentation/eco-controller.decorator";
import { EmployeesService } from "../application/employees.service";
import { CreateEmployeeDto, EmployeeQueryDto, UpdateEmployeeDto } from "./employees.dto";

class ReasonDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

@EcoController("employees", "Eco Sor - Employees")
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @Permissions("employees.manage", "users.manage", "attendance.own")
  async list(@Actor() actor: Principal, @Query() query: EmployeeQueryDto) {
    const r = await this.employees.list(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  @Get(":id")
  @Permissions("employees.manage", "users.manage", "attendance.own")
  async get(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.employees.get(actor, id));
  }

  /** Sub-accounts (HR, sales, support ...) are created by the company Super Admin / admin only. */
  @Post()
  @RequireRoles("admin")
  @Permissions("employees.manage", "users.manage")
  async create(@Actor() actor: Principal, @Body() dto: CreateEmployeeDto) {
    return ok(await this.employees.create(actor, dto));
  }

  @Patch(":id")
  @Permissions("employees.manage")
  async update(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: UpdateEmployeeDto) {
    return ok(await this.employees.update(actor, id, dto));
  }

  @Post(":id/activate")
  @HttpCode(200)
  @RequireRoles("admin")
  @Permissions("employees.manage", "users.manage")
  async activate(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: ReasonDto) {
    return ok(await this.employees.setActive(actor, id, true, dto.reason));
  }

  @Post(":id/deactivate")
  @HttpCode(200)
  @RequireRoles("admin")
  @Permissions("employees.manage", "users.manage")
  async deactivate(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: ReasonDto) {
    return ok(await this.employees.setActive(actor, id, false, dto.reason));
  }

  @Post(":id/reset-password")
  @HttpCode(200)
  @RequireRoles("admin")
  @Permissions("employees.manage", "users.manage")
  async resetPassword(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.employees.resetPassword(actor, id));
  }
}
