import { Body, HttpCode, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ok } from "../../../common/eco/http";
import { IdParam } from "../../../common/eco/params";
import type { Principal } from "../../rbac/domain/principal";
import { Actor, Permissions } from "../../rbac/presentation/decorators";
import { EcoController } from "../../rbac/presentation/eco-controller.decorator";
import { ServiceService } from "../application/service.service";
import { AssignDto, ReassignDto, ReopenDto, ServiceCheckInDto, ServiceReportDto, VerifyOtpDto } from "./service.dto";

/** Field-service actions on a complaint (the complaint itself is read from GET /complaints/:id). */
@EcoController("complaints", "Eco Sor - Service")
export class ServiceController {
  constructor(private readonly service: ServiceService) {}

  @Post(":id/assign")
  @HttpCode(200)
  @Permissions("complaints.assign")
  async assign(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: AssignDto) {
    return ok(await this.service.assign(actor, id, dto));
  }

  @Post(":id/reassign")
  @HttpCode(200)
  @Permissions("complaints.assign")
  async reassign(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: ReassignDto) {
    return ok(await this.service.reassign(actor, id, dto));
  }

  @Post(":id/check-in")
  @HttpCode(200)
  @Permissions("complaints.service")
  async checkIn(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: ServiceCheckInDto) {
    return ok(await this.service.checkIn(actor, id, dto));
  }

  @Post(":id/service-report")
  @Permissions("complaints.service")
  async report(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: ServiceReportDto) {
    return ok(await this.service.serviceReport(actor, id, dto));
  }

  /** Sends a single-use code to the customer's WhatsApp. The code itself is never in the response. */
  @Post(":id/send-otp")
  @HttpCode(200)
  @Permissions("complaints.service", "complaints.assign")
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  async sendOtp(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.service.sendOtp(actor, id));
  }

  @Post(":id/verify-otp")
  @HttpCode(200)
  @Permissions("complaints.service", "complaints.assign")
  @Throttle({ default: { limit: 20, ttl: 900_000 } })
  async verifyOtp(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: VerifyOtpDto) {
    return ok(await this.service.verifyOtp(actor, id, dto.otp));
  }

  @Post(":id/close")
  @HttpCode(200)
  @Permissions("complaints.close")
  async close(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.service.close(actor, id));
  }

  @Post(":id/reopen")
  @HttpCode(200)
  @Permissions("complaints.view")
  async reopen(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: ReopenDto) {
    return ok(await this.service.reopen(actor, id, dto.reason));
  }
}
