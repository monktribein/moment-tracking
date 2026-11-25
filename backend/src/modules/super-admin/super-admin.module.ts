import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { OrmModule } from "../../database/orm-nest";
import { LEAD_CONNECTION } from "../lead-collection/domain/lead-collection.constants";
import { LeadDatabaseModule } from "../lead-collection/infrastructure/lead-database.module";
import { AdminAuthService } from "./application/admin-auth.service";
import { AdminScopeService } from "./application/admin-scope.service";
import { ADMIN_USER_MODEL } from "./domain/super-admin.constants";
import { AdminJwtStrategy } from "./infrastructure/admin-jwt.strategy";
import { AdminUserSchema } from "./infrastructure/admin-user.schema";
import { AdminAuthController } from "./presentation/admin-auth.controller";

/**
 * Super Admin accounts and sign-in. Tables live in the same database (schema
 * `leads`) as the lead data, on the lead connection.
 */
@Module({
  imports: [
    LeadDatabaseModule,
    OrmModule.forFeature([{ name: ADMIN_USER_MODEL, schema: AdminUserSchema }], LEAD_CONNECTION),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("jwtSecret") || "development-only-secret",
        signOptions: {
          expiresIn: (config.get<string>("jwtExpiresIn") ?? "12h") as never,
          issuer: config.get<string>("jwtIssuer"),
          audience: config.get<string>("jwtAudience"),
        },
      }),
    }),
  ],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminJwtStrategy, AdminScopeService],
  exports: [AdminScopeService],
})
export class SuperAdminModule {}
