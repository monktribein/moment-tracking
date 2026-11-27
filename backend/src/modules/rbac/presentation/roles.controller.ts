import { Body, Get, HttpCode, Param, Put } from "@nestjs/common";
import { ArrayMaxSize, ArrayUnique, IsArray, IsString } from "class-validator";
import { ok } from "../../../common/eco/http";
import { AuditService } from "../../audit/application/audit.service";
import { SqlService } from "../../../database/sql/sql.service";
import { IsEntityId } from "../../../common/decorators/is-entity-id.decorator";
import { PERMISSIONS } from "../domain/rbac.constants";
import type { Principal } from "../domain/principal";
import { Actor, Permissions } from "./decorators";
import { EcoController } from "./eco-controller.decorator";
import { BadRequestException, NotFoundException } from "@nestjs/common";

class SetPermissionsDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(100) @IsString({ each: true }) permissions!: string[];
}

class RoleIdParam {
  @IsEntityId() id!: string;
}

@EcoController("roles", "Eco Sor - Roles")
export class RolesAdminController {
  constructor(
    private readonly sql: SqlService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Permissions("roles.manage", "users.manage", "employees.manage")
  async list(@Actor() actor: Principal) {
    const roles = await this.sql.all(
      `SELECT r.id, r.code, r.name, r.description, r.is_active,
              coalesce(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
         FROM leads.roles r LEFT JOIN leads.role_permissions rp ON rp.role_id = r.id LEFT JOIN leads.permissions p ON p.id = rp.permission_id
        WHERE r.company_id = $1 GROUP BY r.id ORDER BY r.name`,
      [actor.companyId],
    );
    return ok({ roles, catalogue: PERMISSIONS });
  }

  /** Replaces a role's permissions. The admin role always keeps everything. */
  @Put(":id/permissions")
  @Permissions("roles.manage")
  @HttpCode(200)
  async setPermissions(@Actor() actor: Principal, @Param() { id }: RoleIdParam, @Body() dto: SetPermissionsDto) {
    const unknown = dto.permissions.filter((p) => !(p in PERMISSIONS));
    if (unknown.length) throw new BadRequestException(`Unknown permission: ${unknown[0]}`);
    const role = await this.sql.one<{ code: string }>(`SELECT code FROM leads.roles WHERE id = $1 AND company_id = $2`, [id, actor.companyId]);
    if (!role) throw new NotFoundException("Role not found");
    if (role.code === "admin") throw new BadRequestException("The admin role always has every permission.");
    await this.sql.tx(async (db) => {
      const before = await db.all<{ code: string }>(`SELECT p.code FROM leads.role_permissions rp JOIN leads.permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1 ORDER BY p.code`, [id]);
      await db.exec(`DELETE FROM leads.role_permissions WHERE role_id = $1`, [id]);
      await db.exec(
        `INSERT INTO leads.role_permissions (company_id, role_id, permission_id) SELECT $1, $2, p.id FROM leads.permissions p WHERE p.code = ANY($3::text[])`,
        [actor.companyId, id, dto.permissions],
      );
      await this.audit.log(actor, "role.permissions_changed", "role", id, { permissions: before.map((b) => b.code) }, { permissions: [...dto.permissions].sort() }, null, db);
    });
    return ok({ roleId: id, permissions: [...dto.permissions].sort() });
  }
}

