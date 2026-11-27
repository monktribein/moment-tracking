import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { SqlService } from "../../../database/sql/sql.service";
import { createProvider, whatsappEnv } from "../infrastructure/whatsapp-providers";
import type { WhatsAppEvent, WhatsAppProvider } from "../domain/whatsapp.types";

export interface NotifyInput {
  companyId: string;
  event: WhatsAppEvent;
  /** 10-digit mobile (the country code is added). Omit to send in-app only. */
  mobile?: string | null;
  /** Also creates an in-app notification for this user. */
  userId?: string | null;
  title?: string;
  body?: string;
  /** Template variables, in order. Stored in whatsapp_logs and reused by retries. */
  params?: string[];
  /** A one-time code: sent, but never stored and never retried. */
  otp?: string;
  entity?: string;
  entityId?: string;
}

export const MAX_WHATSAPP_RETRIES = 3;

/** Digits of an Indian mobile, or null when it is not a valid 10-digit number. */
export const tenDigits = (value: string | null | undefined): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
};

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly env = whatsappEnv();
  private readonly provider: WhatsAppProvider = createProvider(this.env);
  private readonly country = process.env.WHATSAPP_COUNTRY_CODE ?? "91";
  private readonly language = process.env.WHATSAPP_LANGUAGE ?? "en";
  private retrying = false;

  constructor(private readonly sql: SqlService) {
    if (this.env.provider !== "log" && !this.env.apiKey) this.logger.error(`WHATSAPP_PROVIDER=${this.env.provider} but WHATSAPP_API_KEY is empty: every message will fail.`);
  }

  get providerName(): string {
    return this.provider.name;
  }

  private templateFor(event: string): string {
    return process.env[`WHATSAPP_TEMPLATE_${event.toUpperCase()}`] || event;
  }

  /**
   * Records the message in whatsapp_logs, sends it and updates the row with the
   * outcome. Never throws: a failed message must not fail the business action
   * that triggered it (the retry job picks failures up).
   */
  async notify(input: NotifyInput): Promise<{ status: "sent" | "failed" | "skipped"; logId?: string }> {
    try {
      if (input.userId)
        await this.sql.exec(
          `INSERT INTO leads.notifications (company_id, user_id, event, title, body, data, channel, sent_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'in_app', now())`,
          [input.companyId, input.userId, input.event, input.title ?? input.event.replace(/_/g, " "), input.body ?? "", JSON.stringify({ entity: input.entity ?? null, entityId: input.entityId ?? null })],
        );
      const mobile = tenDigits(input.mobile);
      if (!mobile) return { status: "skipped" };
      const template = this.templateFor(input.event);
      const row = await this.sql.one<{ id: string }>(
        `INSERT INTO leads.whatsapp_logs (company_id, event, recipient, template, payload, status, entity, entity_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'queued', $6, $7) RETURNING id`,
        [input.companyId, input.event, `${this.country}${mobile}`, template, JSON.stringify({ params: input.params ?? [], hasOtp: Boolean(input.otp), retryable: !input.otp }), input.entity ?? null, input.entityId ?? null],
      );
      const logId = row!.id;
      const result = await this.dispatch(logId, `${this.country}${mobile}`, template, input.params ?? [], input.otp, 0);
      return { status: result ? "sent" : "failed", logId };
    } catch (error) {
      this.logger.error(`notify(${input.event}) failed: ${(error as Error).message}`);
      return { status: "failed" };
    }
  }

  private async dispatch(logId: string, to: string, template: string, params: string[], otp: string | undefined, retries: number): Promise<boolean> {
    const result = await this.provider.send({ to, template, language: this.language, params, otp });
    if (result.ok) {
      await this.sql.exec(`UPDATE leads.whatsapp_logs SET status = 'sent', provider_msg_id = $2, retries = $3::double precision, error = NULL, next_retry_at = NULL, sent_at = now() WHERE id = $1`, [logId, result.providerMsgId ?? null, retries]);
      return true;
    }
    const exhausted = retries >= MAX_WHATSAPP_RETRIES || Boolean(otp);
    await this.sql.exec(
      `UPDATE leads.whatsapp_logs SET status = 'failed', error = $2, retries = $3::double precision, next_retry_at = ${exhausted ? "NULL" : "now() + ($3::double precision + 1) * interval '2 minutes'"} WHERE id = $1`,
      [logId, result.error ?? "send failed", retries],
    );
    return false;
  }

  /** Retries failed messages (at most 3 times each, spaced out). One-time codes are never retried. */
  @Cron(CronExpression.EVERY_MINUTE)
  async retryFailed(): Promise<number> {
    if (this.retrying || process.env.WHATSAPP_RETRY_ENABLED === "false") return 0;
    this.retrying = true;
    try {
      const due = await this.sql.all<{ id: string; recipient: string; template: string; payload: { params?: string[]; retryable?: boolean }; retries: number }>(
        `SELECT id, recipient, template, payload, retries FROM leads.whatsapp_logs
          WHERE status = 'failed' AND retries < $1 AND next_retry_at IS NOT NULL AND next_retry_at <= now() AND coalesce((payload->>'retryable')::boolean, true)
          ORDER BY next_retry_at LIMIT 25`,
        [MAX_WHATSAPP_RETRIES],
      );
      let sent = 0;
      for (const message of due) {
        const claimed = await this.sql.exec(`UPDATE leads.whatsapp_logs SET next_retry_at = NULL WHERE id = $1 AND next_retry_at IS NOT NULL`, [message.id]);
        if (!claimed) continue;
        if (await this.dispatch(message.id, message.recipient, message.template, message.payload?.params ?? [], undefined, message.retries + 1)) sent++;
      }
      return sent;
    } catch (error) {
      this.logger.error(`retry job failed: ${(error as Error).message}`);
      return 0;
    } finally {
      this.retrying = false;
    }
  }
}
