import { Body, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { ok, paged } from "../../../common/eco/http";
import { IdParam } from "../../../common/eco/params";
import type { Principal } from "../../rbac/domain/principal";
import { Actor, Permissions } from "../../rbac/presentation/decorators";
import { EcoController } from "../../rbac/presentation/eco-controller.decorator";
import { ProductsService } from "../application/products.service";
import { CreateProductDto, ProductQueryDto, SetActiveDto, UpdateProductDto } from "./products.dto";

@EcoController("products", "Eco Sor - Products")
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Managers see all products; everyone else only active ones (the only ones that can be ordered). */
  @Get()
  @Permissions("products.view", "products.manage")
  async list(@Actor() actor: Principal, @Query() query: ProductQueryDto) {
    const r = await this.products.list(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  @Get(":id")
  @Permissions("products.view", "products.manage")
  async get(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.products.get(actor, id));
  }

  @Post()
  @Permissions("products.manage")
  async create(@Actor() actor: Principal, @Body() dto: CreateProductDto) {
    return ok(await this.products.create(actor, dto));
  }

  @Patch(":id")
  @Permissions("products.manage")
  async update(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: UpdateProductDto) {
    return ok(await this.products.update(actor, id, dto));
  }

  @Patch(":id/active")
  @Permissions("products.manage")
  async setActive(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: SetActiveDto) {
    return ok(await this.products.setActive(actor, id, dto.isActive));
  }

  /** multipart/form-data, field "file": JPG or PNG, up to 2 MB. */
  @Post(":id/image")
  @Permissions("products.manage")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 + 1, files: 1 } }))
  async image(@Actor() actor: Principal, @Param() { id }: IdParam, @UploadedFile() file: Express.Multer.File) {
    return ok(await this.products.setImage(actor, id, file));
  }
}
