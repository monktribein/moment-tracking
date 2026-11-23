import { Global, Module } from "@nestjs/common";
import { LeadDatabaseModule } from "../modules/lead-collection/infrastructure/lead-database.module";
import { HealthController } from "./health.controller";

@Global()
@Module({
  imports: [LeadDatabaseModule],
  controllers: [HealthController],
})
export class CommonModule {}
