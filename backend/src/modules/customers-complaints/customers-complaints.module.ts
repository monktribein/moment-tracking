import { Module } from "@nestjs/common";
import { UsersEmployeesModule } from "../users-employees/users-employees.module";
import { CustomersService } from "./application/customers.service";
import { ComplaintsController, CustomerProductsController, CustomersController } from "./presentation/customers.controller";

@Module({ imports: [UsersEmployeesModule], controllers: [CustomersController, CustomerProductsController, ComplaintsController], providers: [CustomersService], exports: [CustomersService] })
export class CustomersComplaintsModule {}
