import { Module } from "@nestjs/common";
import { AttendanceService } from "./application/attendance.service";
import { ExpensesLeavesService } from "./application/expenses-leaves.service";
import { PayrollService } from "./application/payroll.service";
import { AttendanceController, ExpensesController, HolidaysController, LeavesController, PayrollController, SettingsController } from "./presentation/hr.controller";

/** HR: attendance (the existing table), corrections, expenses, leave, holidays, payroll and payroll settings. */
@Module({
  controllers: [AttendanceController, HolidaysController, ExpensesController, LeavesController, PayrollController, SettingsController],
  providers: [AttendanceService, ExpensesLeavesService, PayrollService],
  exports: [PayrollService],
})
export class HrModule {}
