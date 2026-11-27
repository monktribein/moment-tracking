import { Body, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ok, paged } from "../../../common/eco/http";
import { IdParam } from "../../../common/eco/params";
import type { Principal } from "../../rbac/domain/principal";
import { Actor, Permissions } from "../../rbac/presentation/decorators";
import { EcoController } from "../../rbac/presentation/eco-controller.decorator";
import { AttendanceService } from "../application/attendance.service";
import { ExpensesLeavesService } from "../application/expenses-leaves.service";
import { PayrollService } from "../application/payroll.service";
import {
  AdjustmentDto,
  AttendanceCorrectionDto,
  AttendanceMarkDto,
  AttendanceQueryDto,
  CreateExpenseDto,
  CreateLeaveDto,
  ExpenseQueryDto,
  ExpenseReasonDto,
  GenerateBodyDto,
  GenerateQueryDto,
  HolidayDto,
  HolidayQueryDto,
  LeaveDecisionDto,
  LeaveQueryDto,
  LeaveRejectDto,
  PayrollQueryDto,
  ReimburseDto,
  SettingsDto,
  UpdateHolidayDto,
} from "./hr.dto";

@EcoController("attendance", "Eco Sor - Attendance")
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post("check-in")
  @HttpCode(200)
  @Permissions("attendance.own")
  async checkIn(@Actor() actor: Principal, @Body() dto: AttendanceMarkDto) {
    return ok(await this.attendance.checkIn(actor, dto));
  }

  @Post("check-out")
  @HttpCode(200)
  @Permissions("attendance.own")
  async checkOut(@Actor() actor: Principal, @Body() dto: AttendanceMarkDto) {
    return ok(await this.attendance.checkOut(actor, dto));
  }

  @Get("today")
  @Permissions("attendance.own")
  async today(@Actor() actor: Principal) {
    return ok(await this.attendance.today(actor));
  }

  @Get("history")
  @Permissions("attendance.own")
  async history(@Actor() actor: Principal, @Query() query: AttendanceQueryDto) {
    const r = await this.attendance.history(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  /** Everyone's attendance (HR, managers). */
  @Get()
  @Permissions("attendance.view")
  async list(@Actor() actor: Principal, @Query() query: AttendanceQueryDto) {
    const r = await this.attendance.list(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  @Post("corrections")
  @Permissions("attendance.correct")
  async correct(@Actor() actor: Principal, @Body() dto: AttendanceCorrectionDto) {
    return ok(await this.attendance.correct(actor, dto));
  }
}

@EcoController("holidays", "Eco Sor - Holidays")
export class HolidaysController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @Permissions("attendance.own", "holidays.manage")
  async list(@Actor() actor: Principal, @Query() query: HolidayQueryDto) {
    return ok(await this.attendance.listHolidays(actor, query.year));
  }

  @Post()
  @Permissions("holidays.manage")
  async create(@Actor() actor: Principal, @Body() dto: HolidayDto) {
    return ok(await this.attendance.createHoliday(actor, dto));
  }

  @Patch(":id")
  @Permissions("holidays.manage")
  async update(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: UpdateHolidayDto) {
    return ok(await this.attendance.updateHoliday(actor, id, dto));
  }

  @Delete(":id")
  @Permissions("holidays.manage")
  async remove(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.attendance.deleteHoliday(actor, id));
  }
}

@EcoController("expenses", "Eco Sor - Expenses")
export class ExpensesController {
  constructor(private readonly hr: ExpensesLeavesService) {}

  /** Own expenses; approvers also see their team's (HR and admin see everyone's). */
  @Get()
  @Permissions("expenses.submit", "expenses.approve")
  async list(@Actor() actor: Principal, @Query() query: ExpenseQueryDto) {
    const r = await this.hr.listExpenses(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  @Post()
  @Permissions("expenses.submit")
  async create(@Actor() actor: Principal, @Body() dto: CreateExpenseDto, @Headers("idempotency-key") key?: string) {
    return ok(await this.hr.createExpense(actor, dto, key));
  }

  @Post(":id/approve")
  @HttpCode(200)
  @Permissions("expenses.approve")
  async approve(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.hr.approveExpense(actor, id));
  }

  @Post(":id/reject")
  @HttpCode(200)
  @Permissions("expenses.approve")
  async reject(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: ExpenseReasonDto) {
    return ok(await this.hr.rejectExpense(actor, id, dto.reason));
  }

  @Post(":id/reimburse")
  @HttpCode(200)
  @Permissions("expenses.approve")
  async reimburse(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: ReimburseDto) {
    return ok(await this.hr.reimburseExpense(actor, id, dto.reference));
  }
}

@EcoController("leaves", "Eco Sor - Leave")
export class LeavesController {
  constructor(private readonly hr: ExpensesLeavesService) {}

  @Get()
  @Permissions("leaves.apply", "leaves.approve")
  async list(@Actor() actor: Principal, @Query() query: LeaveQueryDto) {
    const r = await this.hr.listLeaves(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  @Post()
  @Permissions("leaves.apply")
  async create(@Actor() actor: Principal, @Body() dto: CreateLeaveDto) {
    return ok(await this.hr.createLeave(actor, dto));
  }

  @Post(":id/approve")
  @HttpCode(200)
  @Permissions("leaves.approve")
  async approve(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: LeaveDecisionDto) {
    return ok(await this.hr.approveLeave(actor, id, dto.note ?? null));
  }

  @Post(":id/reject")
  @HttpCode(200)
  @Permissions("leaves.approve")
  async reject(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: LeaveRejectDto) {
    return ok(await this.hr.rejectLeave(actor, id, dto.note));
  }
}

@EcoController("payroll", "Eco Sor - Payroll")
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  /** HR sees all payroll; an employee only their own finalized payslips. */
  @Get()
  @Permissions("payroll.manage", "attendance.own")
  async list(@Actor() actor: Principal, @Query() query: PayrollQueryDto) {
    const r = await this.payroll.list(actor, query);
    return paged(r.items, r.page, r.limit, r.total);
  }

  /** fixed salary / calculation days x payable days + adjustments, using the payroll.* settings. Re-running only refreshes drafts. */
  @Post("generate")
  @HttpCode(200)
  @Permissions("payroll.manage")
  async generate(@Actor() actor: Principal, @Query() query: GenerateQueryDto, @Body() body: GenerateBodyDto) {
    return ok(await this.payroll.generate(actor, query.month, body.employeeId));
  }

  @Patch(":id/adjustment")
  @Permissions("payroll.manage")
  async adjust(@Actor() actor: Principal, @Param() { id }: IdParam, @Body() dto: AdjustmentDto) {
    return ok(await this.payroll.adjust(actor, id, dto));
  }

  @Post(":id/approve")
  @HttpCode(200)
  @Permissions("payroll.manage")
  async approve(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.payroll.approve(actor, id));
  }

  /** Locks the record permanently. */
  @Post(":id/finalize")
  @HttpCode(200)
  @Permissions("payroll.manage")
  async finalize(@Actor() actor: Principal, @Param() { id }: IdParam) {
    return ok(await this.payroll.finalize(actor, id));
  }
}

@EcoController("settings", "Eco Sor - Settings")
export class SettingsController {
  constructor(private readonly payroll: PayrollService) {}

  @Get("payroll")
  @Permissions("payroll.manage", "settings.manage")
  async get(@Actor() actor: Principal) {
    return ok(await this.payroll.settings(actor.companyId));
  }

  @Put("payroll")
  @Permissions("settings.manage")
  async save(@Actor() actor: Principal, @Body() dto: SettingsDto) {
    return ok(await this.payroll.saveSettings(actor, dto.payroll));
  }
}
