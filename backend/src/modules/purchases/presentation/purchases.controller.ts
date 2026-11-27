import { Body, Get, Headers, HttpCode, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { ok, paged } from "../../../common/eco/http";
import { IdParam } from "../../../common/eco/params";
import { PaymentsService } from "../../payments/application/payments.service";
import { PaymentProofDto, RejectPaymentDto, VerifyPaymentDto } from "../../payments/presentation/payments.dto";
import type { Principal } from "../../rbac/domain/principal";
import { Actor, Permissions } from "../../rbac/presentation/decorators";
import { EcoController } from "../../rbac/presentation/eco-controller.decorator";
import { PurchasesService } from "../application/purchases.service";
import { CreatePurchaseDto, OptionalReasonDto, ProcessDto, PurchaseQueryDto, ReasonDto, UpdateDraftDto } from "./purchases.dto";

@EcoController("purchase-requests", "Eco Sor - Purchase requests")
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly payments: PaymentsService,
  ) {}

  /** Distributors see their own requests; tele/field sales those they created or for their distributors; managers all. */
  @Get()
  @Permissions("purchases.view")
  async list(@Actor() actor: Principal, @Query() query: PurchaseQueryDto) {
    const r = await this.purchases.list(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  /** Creates a draft. Send an `Idempotency-Key` header (8-128 chars) so a retried request does not create a second one. */
  @Post()
  @Permissions("purchases.create")
  async create(@Actor() actor: Principal, @Body() dto: CreatePurchaseDto, @Headers("idempotency-key") key?: string) {
    return ok(await this.purchases.create(actor, dto, key?.trim() || undefined));
  }

  @Get(":id")
  @Permissions("purchases.view")
  async get(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.purchases.get(actor, id));
  }

  @Get(":id/history")
  @Permissions("purchases.view")
  async history(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.purchases.history(actor, id));
  }

  /** Edits items/remarks of a draft or of a request sent back for correction. */
  @Patch(":id/draft")
  @Permissions("purchases.create")
  async updateDraft(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: UpdateDraftDto) {
    return ok(await this.purchases.updateDraft(actor, id, dto));
  }

  @Post(":id/submit")
  @HttpCode(200)
  @Permissions("purchases.create")
  async submit(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.purchases.submit(actor, id));
  }

  /** multipart/form-data: amount, method, paymentDate, utr + file (JPG/PNG, 5 MB). Replaces any earlier unverified submission. */
  @Post(":id/payment-proof")
  @Permissions("purchases.create")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 + 1, files: 1 } }))
  async paymentProof(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: PaymentProofDto, @UploadedFile() file: Express.Multer.File) {
    return ok(await this.payments.submitPayment(actor, id, dto, file));
  }

  @Post(":id/verify-payment")
  @HttpCode(200)
  @Permissions("payments.verify")
  async verifyPayment(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: VerifyPaymentDto) {
    return ok(await this.payments.verify(actor, id, dto.note));
  }

  @Post(":id/reject-payment")
  @HttpCode(200)
  @Permissions("payments.verify")
  async rejectPayment(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: RejectPaymentDto) {
    return ok(await this.payments.reject(actor, id, dto.reason));
  }

  @Post(":id/resubmit")
  @HttpCode(200)
  @Permissions("purchases.create")
  async resubmit(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.purchases.resubmit(actor, id));
  }

  @Post(":id/approve")
  @HttpCode(200)
  @Permissions("purchases.approve")
  async approve(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.purchases.approve(actor, id));
  }

  @Post(":id/reject")
  @HttpCode(200)
  @Permissions("purchases.approve")
  async reject(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: ReasonDto) {
    return ok(await this.purchases.reject(actor, id, dto.reason));
  }

  @Post(":id/cancel")
  @HttpCode(200)
  @Permissions("purchases.create", "purchases.approve", "purchases.review")
  async cancel(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: OptionalReasonDto) {
    return ok(await this.purchases.cancel(actor, id, dto.reason ?? null));
  }

  @Post(":id/process")
  @HttpCode(200)
  @Permissions("purchases.process")
  async process(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: ProcessDto) {
    return ok(await this.purchases.process(actor, id, dto.externalInvoiceRef));
  }
}
