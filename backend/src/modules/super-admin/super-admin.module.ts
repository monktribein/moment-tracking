import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { LeadDatabaseModule } from "../lead-collection/infrastructure/lead-database.module";
import { AdminAuthService } from "./application/admin-auth.service";
import { AdminScopeService } from "./application/admin-scope.service";
import { AdminJwtStrategy } from "./infrastructure/admin-jwt.strategy";
import { AdminAuthController } from "./presentation/admin-auth.controller";

/**
 * Console accounts (platform owner and Super Admins) and their sign-in. The
 * AdminUser and Company models are registered by LeadDatabaseModule.
 */
@Module({
  imports: [
    LeadDatabaseModule,
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
