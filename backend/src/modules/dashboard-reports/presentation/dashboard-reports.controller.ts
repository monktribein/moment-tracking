import { ForbiddenException, Get, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { ok, paged } from "../../../common/eco/http";
import { can, type Principal } from "../../rbac/domain/principal";
import { Actor, Permissions, RequireRoles } from "../../rbac/presentation/decorators";
import { EcoController } from "../../rbac/presentation/eco-controller.decorator";
import { DashboardService } from "../application/dashboard.service";
import { ReportsService } from "../application/reports.service";
import { ReportQueryDto } from "./reports.dto";

@EcoController("dashboard", "Eco Sor - Dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("admin")
  @RequireRoles("admin")
  @Permissions("dashboard.view")
  async admin(@Actor() actor: Principal) {
    return ok(await this.dashboard.admin(actor));
  }

  @Get("sales-manager")
  @RequireRoles("sales_manager")
  @Permissions("dashboard.view")
  async salesManager(@Actor() actor: Principal) {
    return ok(await this.dashboard.salesManager(actor));
  }

  /** Tele-sales and field sales: their own distributors, visits, follow-ups and calls. */
  @Get("tele-sales")
  @RequireRoles("tele_sales", "field_sales")
  @Permissions("dashboard.view")
  async teleSales(@Actor() actor: Principal) {
    return ok(await this.dashboard.teleSales(actor));
  }

  @Get("support-manager")
  @RequireRoles("support_manager")
  @Permissions("dashboard.view")
  async supportManager(@Actor() actor: Principal) {
    return ok(await this.dashboard.supportManager(actor));
  }

  @Get("hr")
  @RequireRoles("hr")
  @Permissions("dashboard.view")
  async hr(@Actor() actor: Principal) {
    return ok(await this.dashboard.hr(actor));
  }

  @Get("distributor")
  @RequireRoles("distributor")
  @Permissions("dashboard.view")
  async distributor(@Actor() actor: Principal) {
    return ok(await this.dashboard.distributor(actor));
  }
}

@EcoController("reports", "Eco Sor - Reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  private async respond(actor: Principal, section: string, query: ReportQueryDto, res: Response) {
    const csv = query.format === "csv";
    if (csv && !can(actor, "reports.export")) throw new ForbiddenException("You do not have permission to export reports");
    const result = await this.reports.run(actor, section, query, csv);
    if (!csv) return { ...paged(result.rows, result.page, result.limit, result.total), section: result.section, columns: result.columns };
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${section}-${result.section}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store", ...(result.truncated ? { "X-Report-Truncated": "true" } : {}) });
    res.send(this.reports.csv(result));
    return undefined;
  }

  /** section = visits | calls | followups | distributors. */
  @Get("sales")
  @RequireRoles("sales_manager")
  @Permissions("reports.view")
  sales(@Actor() actor: Principal, @Query() query: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(actor, "sales", query, res);
  }

  /** section = requests | payments. origin = employee | distributor. */
  @Get("purchases")
  @RequireRoles("sales_manager")
  @Permissions("reports.view")
  purchases(@Actor() actor: Principal, @Query() query: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(actor, "purchases", query, res);
  }

  /** section = complaints | engineers. */
  @Get("service")
  @RequireRoles("support_manager")
  @Permissions("reports.view")
  service(@Actor() actor: Principal, @Query() query: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(actor, "service", query, res);
  }

  /** section = attendance | expenses | leaves | payroll. */
  @Get("hr")
  @RequireRoles("hr")
  @Permissions("reports.view")
  hr(@Actor() actor: Principal, @Query() query: ReportQueryDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(actor, "hr", query, res);
  }
}
