import { Injectable, NotFoundException } from "@nestjs/common";
import { guarded } from "../../../common/eco/http";
import { paginate, Where } from "../../../common/eco/pagination";
import { SqlService } from "../../../database/sql/sql.service";
import { AuditService } from "../../audit/application/audit.service";
import { can, type Principal } from "../../rbac/domain/principal";
import { MAX_PRODUCT_IMAGE_BYTES, assertImage } from "../../uploads/application/private-storage.service";
import { UploadsService } from "../../uploads/application/uploads.service";
import { NEW_ID } from "../../users-employees/application/account.service";
import type { CreateProductDto, ProductQueryDto, UpdateProductDto } from "../presentation/products.dto";

const COLS = "p.id, p.product_code, p.category, p.name, p.model, p.sku, p.description, p.image_url, p.is_active, p.created_at, p.updated_at";

@Injectable()
export class ProductsService {
  constructor(
    private readonly sql: SqlService,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
  ) {}

  async list(actor: Principal, query: ProductQueryDto) {
    const where = new Where().eq("p.company_id = ?", actor.companyId).eq("p.category = ?", query.category);
    // Only managers see inactive products; everyone else picks from active ones.
    if (!can(actor, "products.manage")) where.raw("p.is_active");
    else if (query.active !== undefined) where.eq("p.is_active = ?", query.active);
    where.search(["p.name", "p.model", "p.sku", "p.product_code"], query.search);
    return paginate(this.sql, { select: COLS, from: "leads.products p", where, sorts: { name: "p.name", createdAt: "p.created_at", sku: "p.sku", category: "p.category" }, query, defaultOrder: "asc", tiebreak: "p.id" });
  }

  async get(actor: Principal, id: string) {
    const row = await this.sql.one(`SELECT ${COLS} FROM leads.products p WHERE p.id = $1 AND p.company_id = $2 ${can(actor, "products.manage") ? "" : "AND p.is_active"}`, [id, actor.companyId]);
    if (!row) throw new NotFoundException("Product not found");
    return row;
  }

  create(actor: Principal, dto: CreateProductDto) {
    return guarded(
      () =>
        this.sql.tx(async (db) => {
          const code = dto.productCode ?? (await db.one<{ n: string }>(`SELECT leads.next_doc_no($1, 'PRD') AS n`, [actor.companyId]))!.n;
          const row = await db.one<{ id: string }>(
            `INSERT INTO leads.products (id, company_id, product_code, category, name, model, sku, description, created_by) VALUES (${NEW_ID}, $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [actor.companyId, code, dto.category, dto.name, dto.model, dto.sku, dto.description ?? null, actor.id],
          );
          const created = await db.one(`SELECT ${COLS} FROM leads.products p WHERE p.id = $1`, [row!.id]);
          await this.audit.log(actor, "product.created", "product", row!.id, null, created, null, db);
          return created;
        }),
      "A product with that SKU or product code already exists",
    );
  }

  update(actor: Principal, id: string, dto: UpdateProductDto) {
    return guarded(
      () =>
        this.sql.tx(async (db) => {
          const before = await db.one(`SELECT ${COLS} FROM leads.products p WHERE p.id = $1 AND p.company_id = $2 FOR UPDATE`, [id, actor.companyId]);
          if (!before) throw new NotFoundException("Product not found");
          await db.exec(
            `UPDATE leads.products SET category = coalesce($3, category), name = coalesce($4, name), model = coalesce($5, model), sku = coalesce($6, sku), description = coalesce($7, description) WHERE id = $1 AND company_id = $2`,
            [id, actor.companyId, dto.category ?? null, dto.name ?? null, dto.model ?? null, dto.sku ?? null, dto.description ?? null],
          );
          const after = await db.one(`SELECT ${COLS} FROM leads.products p WHERE p.id = $1`, [id]);
          await this.audit.log(actor, "product.updated", "product", id, before, after, null, db);
          return after;
        }),
      "A product with that SKU already exists",
    );
  }

  async setActive(actor: Principal, id: string, active: boolean) {
    return this.sql.tx(async (db) => {
      const before = await db.one<{ isActive: boolean }>(`SELECT is_active FROM leads.products WHERE id = $1 AND company_id = $2 FOR UPDATE`, [id, actor.companyId]);
      if (!before) throw new NotFoundException("Product not found");
      await db.exec(`UPDATE leads.products SET is_active = $2 WHERE id = $1`, [id, active]);
      await this.audit.log(actor, active ? "product.activated" : "product.deactivated", "product", id, { isActive: before.isActive }, { isActive: active }, null, db);
      return db.one(`SELECT ${COLS} FROM leads.products p WHERE p.id = $1`, [id]);
    });
  }

  /** Product image: a real JPG or PNG, at most 2 MB, stored with the other public product media. */
  async setImage(actor: Principal, id: string, file: Express.Multer.File | undefined) {
    assertImage(file, MAX_PRODUCT_IMAGE_BYTES);
    const product = await this.sql.one<{ imageUrl: string | null }>(`SELECT image_url FROM leads.products WHERE id = $1 AND company_id = $2`, [id, actor.companyId]);
    if (!product) throw new NotFoundException("Product not found");
    const stored = await this.uploads.upload(file, "products", { allowedKinds: ["image"] });
    await this.sql.tx(async (db) => {
      await db.exec(`UPDATE leads.products SET image_url = $2 WHERE id = $1`, [id, stored.url]);
      await this.audit.log(actor, "product.image_changed", "product", id, { imageUrl: product.imageUrl }, { imageUrl: stored.url }, null, db);
    });
    return this.get(actor, id);
  }
}
