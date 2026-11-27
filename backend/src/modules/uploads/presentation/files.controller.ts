import { BadRequestException, Body, ForbiddenException, Get, HttpCode, Post, Query, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsNotEmpty, IsString, MaxLength, Min } from "class-validator";
import type { Response } from "express";
import { memoryStorage } from "multer";
import { ok } from "../../../common/eco/http";
import { can, type Principal } from "../../rbac/domain/principal";
import { Actor, OpenRoute } from "../../rbac/presentation/decorators";
import { EcoController } from "../../rbac/presentation/eco-controller.decorator";
import { PrivateStorageService } from "../application/private-storage.service";

class UploadDto {
  @IsIn(["photo", "receipt", "proof", "warranty"]) scope!: "photo" | "receipt" | "proof" | "warranty";
}
class UrlQueryDto {
  @IsString() @IsNotEmpty() @MaxLength(300) key!: string;
}
class FileQueryDto extends UrlQueryDto {
  @Type(() => Number) @IsInt() @Min(1) exp!: number;
  @IsString() @MaxLength(100) sig!: string;
}

/** Roles that may open someone else's private image (reviewers, managers, HR). */
const VIEWER_PERMISSIONS = ["payments.verify", "purchases.review", "complaints.view", "complaints.service", "expenses.approve", "employees.manage", "visits.view", "customers.manage", "reports.view"];

@EcoController("", "Eco Sor - Files")
export class FilesController {
  constructor(private readonly storage: PrivateStorageService) {}

  /**
   * Uploads one JPG/PNG (5 MB) to private storage and returns its key, to attach to a
   * report, receipt or complaint. Payment proofs are sent with the payment itself.
   */
  @Post("uploads")
  @HttpCode(201)
  @UseInterceptors(FileInterceptor("file", { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 + 1, files: 1 } }))
  async upload(@Actor() actor: Principal, @UploadedFile() file: Express.Multer.File, @Body() dto: UploadDto) {
    return ok(await this.storage.storeImage(actor.companyId, dto.scope, actor.id, file));
  }

  /** A signed link (valid a few minutes) for a private file the caller owns or is allowed to review. */
  @Get("uploads/url")
  async url(@Actor() actor: Principal, @Query() query: UrlQueryDto) {
    const [company, , owner] = query.key.split("/");
    if (company !== actor.companyId) throw new ForbiddenException("Not allowed");
    if (owner !== actor.id && !VIEWER_PERMISSIONS.some((p) => can(actor, p))) throw new ForbiddenException("Not allowed");
    return ok(this.storage.signedUrl(query.key));
  }

  /** Serves a locally stored private file for a valid, unexpired signed link (STORAGE_DRIVER=local). */
  @Get("files")
  @OpenRoute()
  async file(@Query() query: FileQueryDto, @Res() res: Response) {
    if (!query.key.includes("/")) throw new BadRequestException("Invalid key");
    const { body, mime } = await this.storage.readSigned(query.key, query.exp, query.sig);
    res.set({ "Content-Type": mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" }).send(body);
  }
}
