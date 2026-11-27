import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { ScheduleModule } from "@nestjs/schedule";
import { environment, validateEnvironment } from "./config/environment";
import { CommonModule } from "./common/common.module";
import { RolesGuard } from "./common/guards/roles.guard";
import { JwtAuthGuard } from "./modules/auth/guards/jwt-auth.guard";
import { SuperAdminModule } from "./modules/super-admin/super-admin.module";
// The platform owner (higher authority): companies and their Super Admins. Routes: /api/platform/*.
import { PlatformModule } from "./modules/platform/platform.module";
// The lead system: field agents, leads, regions, attendance, GPS tracking and
// supervisor tools. Routes: /api/lead-collection/*.
import { LeadCollectionModule } from "./modules/lead-collection/lead-collection.module";
// Eco Sor Business Operations Platform. Routes: /api/v1/*.
import { SqlModule } from "./database/sql/sql.module";
import { AuditModule } from "./modules/audit/audit.module";
import { RbacModule } from "./modules/rbac/rbac.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { UploadsModule } from "./modules/uploads/uploads.module";
import { UsersEmployeesModule } from "./modules/users-employees/users-employees.module";
import { ProductsModule } from "./modules/products/products.module";
import { DistributorsModule } from "./modules/distributors/distributors.module";
import { SalesModule } from "./modules/sales/sales.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { PurchasesModule } from "./modules/purchases/purchases.module";
import { CustomersComplaintsModule } from "./modules/customers-complaints/customers-complaints.module";
import { ServiceModule } from "./modules/service/service.module";
import { HrModule } from "./modules/hr/hr.module";
import { DashboardReportsModule } from "./modules/dashboard-reports/dashboard-reports.module";
import { hybridRateLimitTracker, ipRateLimitTracker } from "./common/throttling/rate-limit-trackers";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [environment],
      validate: validateEnvironment,
    }),
    ...(process.env.NODE_ENV === "production"
      ? [
          LoggerModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
              pinoHttp: {
                level: config.get<string>("logLevel") ?? "info",
                redact: [
                  "req.headers.authorization",
                  "req.headers.cookie",
                  "req.body.password",
                  "req.body.currentPassword",
                  "req.body.newPassword",
                  "req.body.token",
                  "res.headers.set-cookie",
                ],
              },
            }),
          }),
        ]
      : []),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: "default",
          ttl: config.get<number>("throttleTtlMs") ?? 60_000,
          limit: config.get<number>("throttleLimit") ?? 120,
          getTracker: hybridRateLimitTracker,
        },
        {
          name: "ipAbuse",
          ttl: config.get<number>("throttleIpAbuseTtlMs") ?? 60_000,
          limit: config.get<number>("throttleIpAbuseLimit") ?? 30_000,
          getTracker: ipRateLimitTracker,
        },
      ],
    }),
    ScheduleModule.forRoot(),
    CommonModule,
    SuperAdminModule,
    PlatformModule,
    LeadCollectionModule,
    SqlModule,
    AuditModule,
    RbacModule,
    NotificationsModule,
    UploadsModule,
    UsersEmployeesModule,
    ProductsModule,
    DistributorsModule,
    SalesModule,
    PaymentsModule,
    PurchasesModule,
    CustomersComplaintsModule,
    ServiceModule,
    HrModule,
    DashboardReportsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
