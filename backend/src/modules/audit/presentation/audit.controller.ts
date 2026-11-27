import { Get, Query } from "@nestjs/common";
import { IsDateString, IsOptional, IsString, MaxLength } from "class-validator";
import { EcoController } from "../../rbac/presentation/eco-controller.decorator";
import { Actor } from "../../rbac/presentation/decorators";
import { Permissions, RequireRoles } from "../../rbac/presentation/decorators";
import type { Principal } from "../../rbac/domain/principal";
import { PageQueryDto } from "../../../common/eco/pagination";
import { paged } from "../../../common/eco/http";
import { IsEntityId } from "../../../common/decorators/is-entity-id.decorator";
import { AuditService } from "../application/audit.service";

class AuditQueryDto extends PageQueryDto {
  @IsOptional() @IsString() @MaxLength(60) entity?: string;
  @IsOptional() @IsEntityId() entityId?: string;
  @IsOptional() @IsString() @MaxLength(80) action?: string;
  @IsOptional() @IsEntityId() actorId?: string;
  @IsOptional() @IsDateString({ strict: false }) from?: string;
  @IsOptional() @IsDateString({ strict: false }) to?: string;
}

@EcoController("audit-logs", "Audit")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequireRoles("admin")
  @Permissions("audit.view")
  async list(@Actor() actor: Principal, @Query() query: AuditQueryDto) {
    const r = await this.audit.list(actor.companyId, query, query);
    return paged(r.items, r.page, r.limit, r.total);
  }
}
