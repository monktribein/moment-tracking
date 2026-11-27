import { Module } from "@nestjs/common";
import { DashboardService } from "./application/dashboard.service";
import { ReportsService } from "./application/reports.service";
import { DashboardController, ReportsController } from "./presentation/dashboard-reports.controller";

@Module({ controllers: [DashboardController, ReportsController], providers: [DashboardService, ReportsService] })
export class DashboardReportsModule {}
