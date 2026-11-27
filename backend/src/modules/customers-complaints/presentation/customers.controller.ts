import { Body, Get, Headers, HttpCode, Param, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { accountRateLimitTracker } from "../../../common/throttling/rate-limit-trackers";
import { ok, paged } from "../../../common/eco/http";
import { IdParam } from "../../../common/eco/params";
import type { Principal } from "../../rbac/domain/principal";
import { Actor, OpenRoute, Permissions, RequireRoles } from "../../rbac/presentation/decorators";
import { EcoController } from "../../rbac/presentation/eco-controller.decorator";
import { CustomersService } from "../application/customers.service";
import { ComplaintQueryDto, CreateComplaintDto, CustomerProductDto, CustomerProductQueryDto, CustomerQueryDto, RegisterCustomerDto, VerifyMobileDto, WarrantyReviewDto } from "./customers.dto";

const perMobile = (limit: number) => ({ default: { limit, ttl: 900_000, getTracker: accountRateLimitTracker("mobile") } });

@EcoController("customers", "Eco Sor - Customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  /** Public. Creates the account and sends a WhatsApp code to the mobile number. */
  @Post("register")
  @OpenRoute()
  @Throttle(perMobile(5))
  async register(@Body() dto: RegisterCustomerDto) {
    return ok(await this.customers.register(dto));
  }

  /** Public. Confirms the WhatsApp code; the customer can sign in afterwards. */
  @Post("register/verify")
  @OpenRoute()
  @HttpCode(200)
  @Throttle(perMobile(10))
  async verify(@Body() dto: VerifyMobileDto) {
    return ok(await this.customers.verifyMobile(dto.mobile, dto.otp));
  }

  @Get("me")
  @RequireRoles("customer")
  @Permissions("customers.self")
  async me(@Actor() actor: Principal) {
    return ok(await this.customers.me(actor));
  }

  @Get()
  @Permissions("customers.manage")
  async list(@Actor() actor: Principal, @Query() query: CustomerQueryDto) {
    const r = await this.customers.listCustomers(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }
}

@EcoController("customer-products", "Eco Sor - Customers")
export class CustomerProductsController {
  constructor(private readonly customers: CustomersService) {}

  /** A customer sees their own products; support staff can filter by customer. */
  @Get()
  @Permissions("customers.self", "customers.manage")
  async list(@Actor() actor: Principal, @Query() query: CustomerProductQueryDto) {
    const r = await this.customers.listProducts(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  /** Sellers to pick from when registering a product (active distributors, name and city only). */
  @Get("distributors")
  @Permissions("customers.self", "customers.manage")
  async distributors(@Actor() actor: Principal, @Query() query: CustomerQueryDto) {
    return ok(await this.customers.distributorChoices(actor, query.search));
  }

  @Post()
  @RequireRoles("customer")
  @Permissions("customers.self")
  async add(@Actor() actor: Principal, @Body() dto: CustomerProductDto) {
    return ok(await this.customers.addProduct(actor, dto));
  }

  @Post(":id/warranty")
  @HttpCode(200)
  @Permissions("customers.manage")
  async warranty(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: WarrantyReviewDto) {
    return ok(await this.customers.reviewWarranty(actor, id, dto));
  }
}

@EcoController("complaints", "Eco Sor - Complaints")
export class ComplaintsController {
  constructor(private readonly customers: CustomersService) {}

  /** Customers see their own complaints, engineers the ones assigned to them, support staff all. */
  @Get()
  @Permissions("complaints.view")
  async list(@Actor() actor: Principal, @Query() query: ComplaintQueryDto) {
    const r = await this.customers.listComplaints(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  /** Customers only. */
  @Post()
  @RequireRoles("customer")
  @Permissions("complaints.create")
  async create(@Actor() actor: Principal, @Body() dto: CreateComplaintDto, @Headers("idempotency-key") key?: string) {
    return ok(await this.customers.createComplaint(actor, dto, key));
  }

  /** The complaint with its full timeline. */
  @Get(":id")
  @Permissions("complaints.view")
  async get(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.customers.getComplaint(actor, id));
  }
}
