import { Module } from "@nestjs/common";
import { ServiceService } from "./application/service.service";
import { ServiceController } from "./presentation/service.controller";

@Module({ controllers: [ServiceController], providers: [ServiceService] })
export class ServiceModule {}
