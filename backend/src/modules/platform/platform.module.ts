import { Module } from "@nestjs/common";
import { LeadDatabaseModule } from "../lead-collection/infrastructure/lead-database.module";
import { PlatformService } from "./application/platform.service";
import { PlatformController } from "./presentation/platform.controller";

/**
 * The platform owner's console API (/api/platform/*): companies and their
 * Super Admin accounts. The models live on LeadDatabaseModule's connection.
 */
@Module({
  imports: [LeadDatabaseModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
