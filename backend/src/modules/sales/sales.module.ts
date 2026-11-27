import { Module } from "@nestjs/common";
import { DistributorsModule } from "../distributors/distributors.module";
import { SalesService } from "./application/sales.service";
import { SalesController } from "./presentation/sales.controller";

@Module({ imports: [DistributorsModule], controllers: [SalesController], providers: [SalesService], exports: [SalesService] })
export class SalesModule {}
