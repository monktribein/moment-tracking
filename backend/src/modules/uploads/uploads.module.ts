import { Module } from "@nestjs/common";
import { UploadsService } from "./application/uploads.service";

/** Cloudinary storage used by the field agents' photo/document uploads (lead-upload.controller). */
@Module({
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
