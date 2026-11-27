import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { EcoAuthService } from "./application/eco-auth.service";
import { MobileOtpService } from "./application/mobile-otp.service";
import { RbacService } from "./application/rbac.service";
import { EcoAuthController } from "./presentation/auth.controller";
import { EcoAuthGuard } from "./presentation/eco-auth.guard";
import { PermissionsGuard } from "./presentation/permissions.guard";
import { RolesAdminController } from "./presentation/roles.controller";

/**
 * Roles, permissions and sign-in for Eco Sor users. Tokens are signed with the
 * same secret, issuer and audience as the Super Admin console (scope "eco" vs
 * "admin"), so a company Super Admin's console token also works here, as `admin`.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("jwtSecret") || "development-only-secret",
        signOptions: { issuer: config.get<string>("jwtIssuer"), audience: config.get<string>("jwtAudience") },
        verifyOptions: { issuer: config.get<string>("jwtIssuer"), audience: config.get<string>("jwtAudience") },
      }),
    }),
  ],
  controllers: [EcoAuthController, RolesAdminController],
  providers: [RbacService, EcoAuthService, MobileOtpService, EcoAuthGuard, PermissionsGuard],
  exports: [RbacService, EcoAuthService, MobileOtpService, EcoAuthGuard, PermissionsGuard],
})
export class RbacModule {}
