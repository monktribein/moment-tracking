import { Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsBoolean, IsOptional } from "class-validator";
import { IsEntityId } from "../../../common/decorators/is-entity-id.decorator";
import { ok, paged } from "../../../common/eco/http";
import { paginate, PageQueryDto, Where } from "../../../common/eco/pagination";
import { SqlService } from "../../../database/sql/sql.service";
import type { Principal } from "../../rbac/domain/principal";
import { Actor, Permissions } from "../../rbac/presentation/decorators";
import { EcoController } from "../../rbac/presentation/eco-controller.decorator";

class NotificationQueryDto extends PageQueryDto {
  @IsOptional() @Transform(({ value }) => value === true || value === "true") @IsBoolean() unread?: boolean;
}
class IdParam {
  @IsEntityId() id!: string;
}

@EcoController("notifications", "Eco Sor - Notifications")
export class NotificationsController {
  constructor(private readonly sql: SqlService) {}

  @Get()
  @Permissions("notifications.view")
  async mine(@Actor() actor: Principal, @Query() query: NotificationQueryDto) {
    const where = new Where().eq("n.company_id = ?", actor.companyId).eq("n.user_id = ?", actor.id);
    if (query.unread) where.raw("n.is_read = false");
    const r = await paginate(this.sql, { select: "n.id, n.event, n.title, n.body, n.data, n.is_read, n.read_at, n.created_at", from: "leads.notifications n", where, sorts: { createdAt: "n.created_at" }, query, tiebreak: "n.id" });
    const unread = await this.sql.one<{ n: number }>(`SELECT count(*)::int AS n FROM leads.notifications WHERE user_id = $1 AND is_read = false`, [actor.id]);
    return { ...paged(r.items, r.page, r.limit, r.total), unread: unread?.n ?? 0 };
  }

  @Post(":id/read")
  @Permissions("notifications.view")
  @HttpCode(200)
  async read(@Actor() actor: Principal, @Param() { id }: IdParam) {
    await this.sql.exec(`UPDATE leads.notifications SET is_read = true, read_at = now() WHERE id = $1 AND user_id = $2 AND is_read = false`, [id, actor.id]);
    return ok({ read: true });
  }

  @Post("read-all")
  @Permissions("notifications.view")
  @HttpCode(200)
  async readAll(@Actor() actor: Principal) {
    const n = await this.sql.exec(`UPDATE leads.notifications SET is_read = true, read_at = now() WHERE user_id = $1 AND is_read = false`, [actor.id]);
    return ok({ marked: n });
  }
}

