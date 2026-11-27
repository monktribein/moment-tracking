import { Body, Get, Headers, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ok, paged } from "../../../common/eco/http";
import { IdParam } from "../../../common/eco/params";
import type { Principal } from "../../rbac/domain/principal";
import { Actor, Permissions } from "../../rbac/presentation/decorators";
import { EcoController } from "../../rbac/presentation/eco-controller.decorator";
import { SalesService } from "../application/sales.service";
import { CallLogQueryDto, CheckInDto, CreateCallLogDto, CreateFollowupDto, CreateVisitDto, FollowupQueryDto, ReasonDto, RescheduleDto, VisitQueryDto, VisitReportDto } from "./sales.dto";

@EcoController("sales", "Eco Sor - Sales")
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  /** Managers see every visit; employees only the visits assigned to them. */
  @Get("visits")
  @Permissions("visits.view")
  async visits(@Actor() actor: Principal, @Query() query: VisitQueryDto) {
    const r = await this.sales.listVisits(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  @Post("visits")
  @Permissions("visits.assign")
  async createVisit(@Actor() actor: Principal, @Body() dto: CreateVisitDto) {
    return ok(await this.sales.createVisit(actor, dto));
  }

  @Get("visits/:id")
  @Permissions("visits.view")
  async visit(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.sales.getVisit(actor, id));
  }

  @Post("visits/:id/check-in")
  @HttpCode(200)
  @Permissions("visits.checkin")
  async checkIn(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: CheckInDto) {
    return ok(await this.sales.checkIn(actor, id, dto));
  }

  @Post("visits/:id/report")
  @Permissions("visits.report")
  async report(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: VisitReportDto) {
    return ok(await this.sales.submitReport(actor, id, dto));
  }

  @Post("visits/:id/complete")
  @HttpCode(200)
  @Permissions("visits.assign")
  async complete(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.sales.complete(actor, id));
  }

  @Post("visits/:id/cancel")
  @HttpCode(200)
  @Permissions("visits.assign")
  async cancel(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: ReasonDto) {
    return ok(await this.sales.cancel(actor, id, dto.reason));
  }

  @Post("visits/:id/reschedule")
  @HttpCode(200)
  @Permissions("visits.assign")
  async reschedule(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: RescheduleDto) {
    return ok(await this.sales.reschedule(actor, id, dto));
  }

  @Get("followups")
  @Permissions("followups.manage")
  async followups(@Actor() actor: Principal, @Query() query: FollowupQueryDto) {
    const r = await this.sales.listFollowups(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  @Post("followups")
  @Permissions("followups.manage")
  async createFollowup(@Actor() actor: Principal, @Body() dto: CreateFollowupDto) {
    return ok(await this.sales.createFollowup(actor, dto));
  }

  @Post("followups/:id/complete")
  @HttpCode(200)
  @Permissions("followups.manage")
  async completeFollowup(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.sales.setFollowupStatus(actor, id, "done"));
  }

  @Post("followups/:id/cancel")
  @HttpCode(200)
  @Permissions("followups.manage")
  async cancelFollowup(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.sales.setFollowupStatus(actor, id, "cancelled"));
  }

  @Get("call-logs")
  @Permissions("calls.log")
  async calls(@Actor() actor: Principal, @Query() query: CallLogQueryDto) {
    const r = await this.sales.listCalls(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  @Post("call-logs")
  @Permissions("calls.log")
  async createCall(@Actor() actor: Principal, @Body() dto: CreateCallLogDto, @Headers("idempotency-key") key?: string) {
    return ok(await this.sales.createCall(actor, dto, key));
  }
}
