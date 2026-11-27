import { Global, Module } from "@nestjs/common";
import { WhatsAppService } from "./application/whatsapp.service";
import { NotificationsController } from "./presentation/notifications.controller";

/**
 * WhatsApp delivery (provider adapter chosen by WHATSAPP_PROVIDER, "log" for
 * development) plus in-app notifications. Every message is saved in
 * whatsapp_logs; failed ones are retried up to 3 times by a scheduled job.
 */
@Global()
@Module({ controllers: [NotificationsController], providers: [WhatsAppService], exports: [WhatsAppService] })
export class NotificationsModule {}
