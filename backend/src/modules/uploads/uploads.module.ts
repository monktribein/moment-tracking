import { Global, Module } from "@nestjs/common";
import { UploadsService } from "./application/uploads.service";
import { PrivateStorageService } from "./application/private-storage.service";
import { FilesController } from "./presentation/files.controller";

/**
 * Cloudinary storage used by the field agents' photo/document uploads
 * (lead-upload.controller) and public product images, plus private storage for
 * payment proofs, receipts and complaint photos (signed, short-lived links).
 */
@Global()
@Module({
  controllers: [FilesController],
  providers: [UploadsService, PrivateStorageService],
  exports: [UploadsService, PrivateStorageService],
})
export class UploadsModule {}
