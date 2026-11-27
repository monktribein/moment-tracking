import { Module } from "@nestjs/common";
import { AccountService } from "./application/account.service";
import { EmployeesService } from "./application/employees.service";
import { EmployeesController } from "./presentation/employees.controller";

/** Employee records and their sign-in accounts (shared by distributor portal and customer registration via AccountService). */
@Module({ controllers: [EmployeesController], providers: [AccountService, EmployeesService], exports: [AccountService] })
export class UsersEmployeesModule {}
