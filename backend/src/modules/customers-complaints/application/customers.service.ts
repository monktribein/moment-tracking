import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { guarded, todayIst } from "../../../common/eco/http";
import { paginate, Where } from "../../../common/eco/pagination";
import { type Db, SqlService } from "../../../database/sql/sql.service";
import { AuditService } from "../../audit/application/audit.service";
import { WhatsAppService } from "../../notifications/application/whatsapp.service";
import { MobileOtpService } from "../../rbac/application/mobile-otp.service";
import { RbacService } from "../../rbac/application/rbac.service";
import type { Principal } from "../../rbac/domain/principal";
import { AccountService, NEW_ID } from "../../users-employees/application/account.service";
import { categoryFitsProduct } from "../domain/complaint-state";
import type { ComplaintQueryDto, CreateComplaintDto, CustomerProductDto, CustomerProductQueryDto, CustomerQueryDto, RegisterCustomerDto, WarrantyReviewDto } from "../presentation/customers.dto";
import { assertCanSeeComplaint, complaintDetail, loadComplaint, logComplaintStatus } from "./complaint-ledger";
import { checkIdempotencyKey, findIdempotent, rememberIdempotent } from "../../../common/eco/idempotency";

const SYSTEM = { id: "", name: "Customer registration" };

@Injectable()
export class CustomersService {
  constructor(
    private readonly sql: SqlService,
    private readonly audit: AuditService,
    private readonly accounts: AccountService,
    private readonly otp: MobileOtpService,
    private readonly rbac: RbacService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  private async resolveCompany(requested?: string): Promise<string> {
    const wanted = requested ?? process.env.CUSTOMER_COMPANY_ID;
    if (wanted) {
      const c = await this.sql.one(`SELECT 1 FROM leads.companies WHERE id = $1 AND status = 'active'`, [wanted]);
      if (!c) throw new BadRequestException("Unknown company");
      return wanted;
    }
    const all = await this.sql.all<{ id: string }>(`SELECT id FROM leads.companies WHERE status = 'active' LIMIT 2`);
    if (all.length !== 1) throw new BadRequestException("companyId is required");
    return all[0].id;
  }

  /**
   * Creates the customer account and sends a WhatsApp code to the mobile number. The account
   * cannot sign in until the code is confirmed (POST /customers/register/verify). Calling this
   * again for a number that is not yet verified updates the details and sends a fresh code.
   */
  async register(dto: RegisterCustomerDto) {
    const mobile = this.accounts.mobile(dto.mobile);
    const companyId = await this.resolveCompany(dto.companyId);
    await this.rbac.ensureCompanyRoles(companyId);
    const customerId = await guarded(
      () =>
        this.sql.tx(async (db) => {
          const existing = await db.one<{ id: string; userId: string | null; mobileVerified: boolean; companyId: string }>(`SELECT id, user_id, mobile_verified, company_id FROM leads.customers WHERE company_id = $1 AND mobile = $2 FOR UPDATE`, [companyId, mobile]);
          if (existing?.mobileVerified) throw new ConflictException("This mobile number is already registered. Sign in instead.");
          if (!existing && (await db.one(`SELECT 1 FROM leads.lead_users WHERE phone = $1`, [mobile]))) throw new ConflictException("This mobile number is already registered");
          if (existing) {
            await db.exec(`UPDATE leads.customers SET name = $2, email = coalesce($3, email), address = coalesce($4, address), city = coalesce($5, city), state = coalesce($6, state), pin = coalesce($7, pin) WHERE id = $1`, [existing.id, dto.name, dto.email ?? null, dto.address ?? null, dto.city ?? null, dto.state ?? null, dto.pin ?? null]);
            if (existing.userId) await this.accounts.setPassword(db, existing.userId, dto.password);
            return existing.id;
          }
          const userId = await this.accounts.createLogin(db, { companyId, name: dto.name, mobile, email: dto.email, password: dto.password, roleCode: "customer", createdBy: { ...SYSTEM, id: "self-registration" }, active: false });
          const row = await db.one<{ id: string }>(
            `INSERT INTO leads.customers (id, company_id, name, mobile, mobile_verified, email, address, city, state, pin, user_id) VALUES (${NEW_ID}, $1, $2, $3, false, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [companyId, dto.name, mobile, dto.email ?? null, dto.address ?? null, dto.city ?? null, dto.state ?? null, dto.pin ?? null, userId],
          );
          await this.audit.log({ id: null, role: "customer", companyId }, "customer.registered", "customer", row!.id, null, { mobile, name: dto.name }, null, db);
          return row!.id;
        }),
      "This mobile number is already registered",
    );
    const sent = await this.otp.issue(companyId, mobile, "register");
    return { customerId, otpSent: sent.delivered, message: sent.delivered ? "A verification code was sent to your WhatsApp number." : "We could not send the code. Try again in a few minutes." };
  }

  async verifyMobile(mobileInput: string, code: string) {
    const mobile = this.accounts.mobile(mobileInput);
    const { companyId } = await this.otp.verify(mobile, "register", code);
    await this.sql.tx(async (db) => {
      const c = await db.one<{ id: string; userId: string }>(`SELECT id, user_id FROM leads.customers WHERE company_id = $1 AND mobile = $2 FOR UPDATE`, [companyId, mobile]);
      if (!c) throw new NotFoundException("Customer not found");
      await db.exec(`UPDATE leads.customers SET mobile_verified = true WHERE id = $1`, [c.id]);
      await this.accounts.setLoginActive(db, c.userId, true);
      await this.audit.log({ id: null, role: "customer", companyId }, "customer.mobile_verified", "customer", c.id, { mobileVerified: false }, { mobileVerified: true }, null, db);
    });
    return { verified: true };
  }

  async me(actor: Principal) {
    if (!actor.customerId) throw new ForbiddenException("This login is not a customer account");
    const profile = await this.sql.one(`SELECT id, name, mobile, mobile_verified, email, address, city, state, pin, created_at FROM leads.customers WHERE id = $1`, [actor.customerId]);
    const counts = await this.sql.one(
      `SELECT (SELECT count(*)::int FROM leads.customer_products WHERE customer_id = $1) AS products,
              (SELECT count(*)::int FROM leads.complaints WHERE customer_id = $1) AS complaints,
              (SELECT count(*)::int FROM leads.complaints WHERE customer_id = $1 AND status NOT IN ('closed')) AS open_complaints`,
      [actor.customerId],
    );
    return { ...profile, ...counts };
  }

  listCustomers(actor: Principal, query: CustomerQueryDto) {
    const where = new Where().eq("c.company_id = ?", actor.companyId).search(["c.name", "c.mobile", "c.email"], query.search);
    return paginate(this.sql, {
      select: `c.id, c.name, c.mobile, c.mobile_verified, c.email, c.city, c.state, c.created_at, (SELECT count(*)::int FROM leads.customer_products p WHERE p.customer_id = c.id) AS product_count, (SELECT count(*)::int FROM leads.complaints k WHERE k.customer_id = c.id) AS complaint_count`,
      from: "leads.customers c",
      where,
      sorts: { createdAt: "c.created_at", name: "c.name" },
      query,
      tiebreak: "c.id",
    });
  }

  /** Active distributors a customer can name as the seller of a product (name and city only). */
  distributorChoices(actor: Principal, search?: string) {
    const where = new Where().eq("company_id = ?", actor.companyId).raw("is_active").search(["firm_name", "city"], search);
    return this.sql.all(`SELECT id, firm_name, city, state FROM leads.distributors ${where.sql} ORDER BY firm_name LIMIT 50`, where.params);
  }

  // ---------------------------------------------------------------- products
  listProducts(actor: Principal, query: CustomerProductQueryDto) {
    const where = new Where().eq("p.company_id = ?", actor.companyId).eq("p.category = ?", query.category).eq("p.warranty_status = ?", query.warrantyStatus);
    where.eq("p.customer_id = ?", actor.role === "customer" ? (actor.customerId ?? "none") : query.customerId);
    where.search(["p.model", "p.serial_no", "c.name"], query.search);
    return paginate(this.sql, {
      select: "p.id, p.customer_id, c.name AS customer_name, p.category, p.model, p.serial_no, p.purchase_date, p.distributor_id, p.proof_key, p.warranty_status, p.warranty_reviewed_at, p.created_at",
      from: "leads.customer_products p JOIN leads.customers c ON c.id = p.customer_id",
      where,
      sorts: { createdAt: "p.created_at", model: "p.model" },
      query,
      tiebreak: "p.id",
    });
  }

  addProduct(actor: Principal, dto: CustomerProductDto) {
    if (!actor.customerId) throw new ForbiddenException("Only customers can register their products");
    if (dto.purchaseDate && dto.purchaseDate > todayIst()) throw new BadRequestException("The purchase date cannot be in the future");
    if (dto.proofKey && !dto.proofKey.startsWith(`${actor.companyId}/`)) throw new BadRequestException("The proof file key is not valid");
    return guarded(
      () =>
        this.sql.tx(async (db) => {
          if (dto.distributorId && !(await db.one(`SELECT 1 FROM leads.distributors WHERE id = $1 AND company_id = $2`, [dto.distributorId, actor.companyId]))) throw new BadRequestException("Distributor not found");
          const row = await db.one<{ id: string }>(
            `INSERT INTO leads.customer_products (id, company_id, customer_id, category, model, serial_no, purchase_date, distributor_id, proof_key) VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [actor.companyId, actor.customerId, dto.category, dto.model, dto.serialNo, dto.purchaseDate ?? null, dto.distributorId ?? null, dto.proofKey ?? null],
          );
          await this.audit.log(actor, "customer_product.registered", "customer_product", row!.id, null, dto, null, db);
          return db.one(`SELECT * FROM leads.customer_products WHERE id = $1`, [row!.id]);
        }),
      "This product (model and serial number) is already registered",
    );
  }

  /** Support reviews the warranty proof by hand and records the result. */
  reviewWarranty(actor: Principal, id: string, dto: WarrantyReviewDto) {
    return this.sql.tx(async (db) => {
      const p = await db.one<any>(`SELECT * FROM leads.customer_products WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
      if (!p) throw new NotFoundException("Product not found");
      await db.exec(`UPDATE leads.customer_products SET warranty_status = $2, warranty_reviewed_by = $3, warranty_reviewed_at = now() WHERE id = $1`, [id, dto.status, actor.id]);
      await this.audit.log(actor, "customer_product.warranty_reviewed", "customer_product", id, { warrantyStatus: p.warrantyStatus }, { warrantyStatus: dto.status }, dto.note ?? null, db);
      return db.one(`SELECT * FROM leads.customer_products WHERE id = $1`, [id]);
    });
  }

  // -------------------------------------------------------------- complaints
  listComplaints(actor: Principal, query: ComplaintQueryDto) {
    const where = new Where().eq("c.company_id = ?", actor.companyId).eq("c.status = ?", query.status).eq("c.category = ?", query.category);
    where.eq("c.created_at >= (?::date)::timestamptz", query.from).eq("c.created_at < ((?::date) + 1)::timestamptz", query.to);
    if (actor.role === "customer") where.eq("c.customer_id = ?", actor.customerId ?? "none");
    else if (actor.role === "field_support") where.eq("a.engineer_id = ?", actor.employeeId ?? "none");
    else where.eq("c.customer_id = ?", query.customerId).eq("a.engineer_id = ?", query.engineerId);
    where.eq("a.scheduled_date = ?", query.scheduledDate);
    where.search(["c.complaint_no", "cu.name", "cp.model", "cp.serial_no"], query.search);
    return paginate(this.sql, {
      select: `c.id, c.complaint_no, c.customer_id, cu.name AS customer_name, cu.city, cp.category AS product_category, cp.model, cp.serial_no, c.category, c.status, c.service_address, a.engineer_id, en.name AS engineer_name, a.scheduled_date, c.created_at, c.updated_at`,
      from: `leads.complaints c JOIN leads.customers cu ON cu.id = c.customer_id JOIN leads.customer_products cp ON cp.id = c.customer_product_id
             LEFT JOIN leads.complaint_assignments a ON a.complaint_id = c.id AND a.is_current LEFT JOIN leads.employees en ON en.id = a.engineer_id`,
      where,
      sorts: { createdAt: "c.created_at", status: "c.status", complaintNo: "c.complaint_no" },
      query,
      tiebreak: "c.id",
    });
  }

  async getComplaint(actor: Principal, id: string, db: Db = this.sql) {
    const c = await loadComplaint(db, actor.companyId, id);
    assertCanSeeComplaint(actor, c);
    return complaintDetail(db, actor.companyId, id);
  }

  /** Only a signed-in customer can raise a complaint, for one of their own registered products. */
  /** A retried request with the same Idempotency-Key returns the complaint created the first time. */
  async createComplaint(actor: Principal, dto: CreateComplaintDto, idempotencyKey?: string) {
    if (actor.role !== "customer" || !actor.customerId) throw new ForbiddenException("Only customers can raise a complaint");
    const key = checkIdempotencyKey(idempotencyKey);
    for (const key of [...(dto.photos ?? []), ...(dto.warrantyProofKey ? [dto.warrantyProofKey] : [])]) if (!key.startsWith(`${actor.companyId}/`)) throw new BadRequestException("A file key is not valid");
    const out = await this.sql.tx(async (db) => {
      const replay = await findIdempotent(db, "complaints", "customer_id", actor.customerId!, key);
      if (replay) return { id: replay, complaintNo: "", mobile: "", replayed: true };
      const product = await db.one<any>(`SELECT p.*, c.address, c.mobile, c.name AS customer_name FROM leads.customer_products p JOIN leads.customers c ON c.id = p.customer_id WHERE p.id = $1 AND p.customer_id = $2`, [dto.customerProductId, actor.customerId]);
      if (!product) throw new BadRequestException("That product is not registered to you");
      if (!categoryFitsProduct(dto.category, product.category)) throw new BadRequestException(`This issue category does not apply to a ${product.category}`);
      const address = dto.serviceAddress ?? product.address;
      if (!address) throw new BadRequestException("A service address is required");
      const no = await db.one<{ n: string }>(`SELECT leads.next_doc_no($1, 'CMP') AS n`, [actor.companyId]);
      const row = await db.one<{ id: string }>(
        `INSERT INTO leads.complaints (id, company_id, complaint_no, customer_id, customer_product_id, category, description, photos, warranty_proof_key, service_address, contact, status)
         VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, 'open') RETURNING id`,
        [actor.companyId, no!.n, actor.customerId, dto.customerProductId, dto.category, dto.description, JSON.stringify(dto.photos ?? []), dto.warrantyProofKey ?? null, address, dto.contact ?? product.mobile],
      );
      await rememberIdempotent(db, "complaints", row!.id, key);
      await logComplaintStatus(db, actor, { id: row!.id, companyId: actor.companyId }, null, "open", "Complaint registered");
      await this.audit.log(actor, "complaint.created", "complaint", row!.id, null, { complaintNo: no!.n, category: dto.category, customerProductId: dto.customerProductId }, null, db);
      return { id: row!.id, complaintNo: no!.n, mobile: product.mobile as string, replayed: false };
    });
    if (!out.replayed) await this.whatsapp.notify({ companyId: actor.companyId, event: "complaint_registered", mobile: out.mobile, userId: actor.id, title: "Complaint registered", body: out.complaintNo, params: [out.complaintNo], entity: "complaint", entityId: out.id });
    return this.getComplaint(actor, out.id);
  }
}
