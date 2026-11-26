import { Module } from "@nestjs/common";
import { OrmModule } from "../../../database/orm-nest";
import { DRIVER_URI, LEAD_DATABASE, configureDatabase } from "../../../database/database";
import {
  LEAD_ATTENDANCE_MODEL,
  LEAD_CONNECTION,
  LEAD_LOCATION_PING_MODEL,
  LEAD_MODEL,
  LEAD_REGION_MODEL,
  LEAD_USER_MODEL,
} from "../domain/lead-collection.constants";
import { ADMIN_USER_MODEL } from "../../super-admin/domain/super-admin.constants";
import { AdminUserSchema } from "../../super-admin/infrastructure/admin-user.schema";
import { COMPANY_MODEL } from "../../platform/domain/platform.constants";
import { CompanySchema } from "../../platform/infrastructure/company.schema";
import { LeadSchema } from "./persistence/lead.schema";
import { LeadRegionSchema } from "./persistence/lead-region.schema";
import { LeadUserSchema } from "./persistence/lead-user.schema";
import { LeadAttendanceSchema } from "./persistence/lead-attendance.schema";
import { LeadLocationPingSchema } from "./persistence/lead-location-ping.schema";

/**
 * The one database connection (schema "leads") and every model on it.
 * Companies and console accounts are registered here too, so the lead,
 * Super Admin and platform modules all share the same models.
 */
@Module({
  imports: [
    OrmModule.forRootAsync({
      connectionName: LEAD_CONNECTION,
      useFactory: () => {
        configureDatabase();
        return { uri: DRIVER_URI, dbName: LEAD_DATABASE };
      },
    }),
    OrmModule.forFeature(
      [
        { name: COMPANY_MODEL, schema: CompanySchema },
        { name: ADMIN_USER_MODEL, schema: AdminUserSchema },
        { name: LEAD_USER_MODEL, schema: LeadUserSchema },
        { name: LEAD_MODEL, schema: LeadSchema },
        { name: LEAD_REGION_MODEL, schema: LeadRegionSchema },
        { name: LEAD_ATTENDANCE_MODEL, schema: LeadAttendanceSchema },
        { name: LEAD_LOCATION_PING_MODEL, schema: LeadLocationPingSchema },
      ],
      LEAD_CONNECTION,
    ),
  ],
  exports: [OrmModule],
})
export class LeadDatabaseModule {}
