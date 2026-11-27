import { Module } from "@nestjs/common";
import { UsersEmployeesModule } from "../users-employees/users-employees.module";
import { DistributorsService } from "./application/distributors.service";
import { DistributorsController } from "./presentation/distributors.controller";

@Module({ imports: [UsersEmployeesModule], controllers: [DistributorsController], providers: [DistributorsService], exports: [DistributorsService] })
export class DistributorsModule {}
