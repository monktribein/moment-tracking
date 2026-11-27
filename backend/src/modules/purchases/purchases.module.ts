import { Module } from "@nestjs/common";
import { DistributorsModule } from "../distributors/distributors.module";
import { PaymentsModule } from "../payments/payments.module";
import { PurchasesService } from "./application/purchases.service";
import { PurchasesController } from "./presentation/purchases.controller";

@Module({ imports: [DistributorsModule, PaymentsModule], controllers: [PurchasesController], providers: [PurchasesService], exports: [PurchasesService] })
export class PurchasesModule {}
