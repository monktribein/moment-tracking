import { Body, Get, HttpCode, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { ok, paged } from "../../../common/eco/http";
import { IdParam } from "../../../common/eco/params";
import type { Principal } from "../../rbac/domain/principal";
import { Actor, Permissions } from "../../rbac/presentation/decorators";
import { EcoController } from "../../rbac/presentation/eco-controller.decorator";
import { DistributorsService, MAX_IMPORT_BYTES } from "../application/distributors.service";
import { AssignExecutiveDto, CreateDistributorDto, DistributorQueryDto, ImportQueryDto, PortalAccessDto, UpdateDistributorDto } from "./distributors.dto";

@EcoController("distributors", "Eco Sor - Distributors")
export class DistributorsController {
  constructor(private readonly distributors: DistributorsService) {}

  /** A distributor sees only itself; tele/field sales only their assigned distributors. */
  @Get()
  @Permissions("distributors.view", "distributors.manage")
  async list(@Actor() actor: Principal, @Query() query: DistributorQueryDto) {
    const r = await this.distributors.list(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  @Post()
  @Permissions("distributors.manage")
  async create(@Actor() actor: Principal, @Body() dto: CreateDistributorDto) {
    return ok(await this.distributors.create(actor, dto));
  }

  /** multipart/form-data, field "file": CSV (max 1 MB). `?dryRun=true` validates without creating. */
  @Post("import")
  @HttpCode(200)
  @Permissions("distributors.import")
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES + 1, files: 1 } }))
  async import(@Actor() actor: Principal, @UploadedFile() file: Express.Multer.File, @Query() query: ImportQueryDto) {
    return ok(await this.distributors.importCsv(actor, file, query.dryRun ?? false));
  }

  @Get(":id")
  @Permissions("distributors.view", "distributors.manage")
  async get(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.distributors.get(actor, id));
  }

  @Patch(":id")
  @Permissions("distributors.manage")
  async update(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: UpdateDistributorDto) {
    return ok(await this.distributors.update(actor, id, dto));
  }

  @Post(":id/assign")
  @HttpCode(200)
  @Permissions("distributors.manage")
  async assign(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: AssignExecutiveDto) {
    return ok(await this.distributors.assign(actor, id, dto));
  }

  @Post(":id/portal-access")
  @HttpCode(200)
  @Permissions("distributors.manage")
  async portal(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: PortalAccessDto) {
    return ok(await this.distributors.setPortalAccess(actor, id, dto.enabled));
  }

  @Get(":id/history")
  @Permissions("distributors.view", "distributors.manage")
  async history(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.distributors.history(actor, id));
  }
}
