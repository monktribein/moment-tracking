import { Get, Param, Query } from "@nestjs/common";
import { ok, paged } from "../../../common/eco/http";
import { IdParam } from "../../../common/eco/params";
import type { Principal } from "../../rbac/domain/principal";
import { Actor, Permissions } from "../../rbac/presentation/decorators";
import { EcoController } from "../../rbac/presentation/eco-controller.decorator";
import { PaymentsService } from "../application/payments.service";
import { PaymentQueueQueryDto } from "./payments.dto";

/**
 * Payment review. Submitting, verifying and rejecting a payment are actions on the
 * purchase request (POST /purchase-requests/:id/payment-proof | verify-payment | reject-payment).
 */
@EcoController("payments", "Eco Sor - Payments")
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Filters: status = pending | verified | rejected | duplicate. */
  @Get("verification-queue")
  @Permissions("payments.verify")
  async queue(@Actor() actor: Principal, @Query() query: PaymentQueueQueryDto) {
    const r = await this.payments.queue(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  /** A signed link to the private payment image, valid for a few minutes. */
  @Get(":id/proof-url")
  @Permissions("payments.verify", "purchases.view")
  async proofUrl(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.payments.proofUrl(actor, id));
  }
}
