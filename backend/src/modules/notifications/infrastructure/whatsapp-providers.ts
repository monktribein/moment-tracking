import { Logger } from "@nestjs/common";
import type { OutboundMessage, SendResult, WhatsAppProvider } from "../domain/whatsapp.types";

export interface WhatsAppEnv {
  provider: string;
  apiUrl: string;
  apiKey: string;
  phoneNumberId: string;
  sender: string;
  appName: string;
  timeoutMs: number;
}

export const whatsappEnv = (env: NodeJS.ProcessEnv = process.env): WhatsAppEnv => ({
  provider: (env.WHATSAPP_PROVIDER ?? "log").trim().toLowerCase(),
  apiUrl: env.WHATSAPP_API_URL ?? "",
  apiKey: env.WHATSAPP_API_KEY ?? "",
  phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  sender: env.WHATSAPP_SENDER ?? "",
  appName: env.WHATSAPP_APP_NAME ?? "",
  timeoutMs: Number(env.WHATSAPP_TIMEOUT_MS) > 0 ? Number(env.WHATSAPP_TIMEOUT_MS) : 10_000,
});

const failure = (error: unknown): SendResult => ({ ok: false, error: String((error as Error)?.message ?? error).slice(0, 300) });

async function post(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: any }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: response.status, body };
}

/** Development provider: writes the message (without the OTP) to the log and reports success. */
export class LogProvider implements WhatsAppProvider {
  readonly name = "log";
  private readonly logger = new Logger("WhatsApp[log]");
  async send(m: OutboundMessage): Promise<SendResult> {
    this.logger.log(`to=${m.to} template=${m.template} params=${JSON.stringify(m.params)}${m.otp ? " otp=[hidden]" : ""}`);
    return { ok: true, providerMsgId: `log-${Date.now().toString(36)}` };
  }
}

/** Meta WhatsApp Cloud API. Authentication templates get the code in the body and the copy-code button. */
export class MetaCloudProvider implements WhatsAppProvider {
  readonly name = "meta";
  constructor(private readonly env: WhatsAppEnv) {}
  async send(m: OutboundMessage): Promise<SendResult> {
    try {
      const base = this.env.apiUrl || "https://graph.facebook.com/v20.0";
      const texts = m.otp ? [m.otp] : m.params;
      const components: unknown[] = [{ type: "body", parameters: texts.map((text) => ({ type: "text", text })) }];
      if (m.otp) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: m.otp }] });
      const r = await post(
        `${base}/${this.env.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${this.env.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", to: m.to, type: "template", template: { name: m.template, language: { code: m.language }, components } }),
        },
        this.env.timeoutMs,
      );
      if (r.status >= 200 && r.status < 300) return { ok: true, providerMsgId: r.body?.messages?.[0]?.id };
      return { ok: false, error: `Meta ${r.status}: ${r.body?.error?.message ?? "request failed"}`.slice(0, 300) };
    } catch (error) {
      return failure(error);
    }
  }
}

/** Interakt public API. */
export class InteraktProvider implements WhatsAppProvider {
  readonly name = "interakt";
  constructor(private readonly env: WhatsAppEnv) {}
  async send(m: OutboundMessage): Promise<SendResult> {
    try {
      const digits = m.to;
      const r = await post(
        this.env.apiUrl || "https://api.interakt.ai/v1/public/message/",
        {
          method: "POST",
          headers: { Authorization: `Basic ${this.env.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            countryCode: `+${digits.slice(0, digits.length - 10)}`,
            phoneNumber: digits.slice(-10),
            type: "Template",
            template: { name: m.template, languageCode: m.language, bodyValues: m.otp ? [m.otp] : m.params, ...(m.otp ? { buttonValues: { "0": [m.otp] } } : {}) },
          }),
        },
        this.env.timeoutMs,
      );
      if (r.status >= 200 && r.status < 300 && r.body?.result !== false) return { ok: true, providerMsgId: r.body?.id };
      return { ok: false, error: `Interakt ${r.status}: ${r.body?.message ?? "request failed"}`.slice(0, 300) };
    } catch (error) {
      return failure(error);
    }
  }
}

/** Gupshup template API. `template.id` is the approved template id (WHATSAPP template names map to ids). */
export class GupshupProvider implements WhatsAppProvider {
  readonly name = "gupshup";
  constructor(private readonly env: WhatsAppEnv) {}
  async send(m: OutboundMessage): Promise<SendResult> {
    try {
      const form = new URLSearchParams({
        source: this.env.sender,
        destination: m.to,
        "src.name": this.env.appName,
        template: JSON.stringify({ id: m.template, params: m.otp ? [m.otp] : m.params }),
      });
      const r = await post(
        this.env.apiUrl || "https://api.gupshup.io/wa/api/v1/template/msg",
        { method: "POST", headers: { apikey: this.env.apiKey, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() },
        this.env.timeoutMs,
      );
      if (r.status >= 200 && r.status < 300 && r.body?.status !== "error") return { ok: true, providerMsgId: r.body?.messageId };
      return { ok: false, error: `Gupshup ${r.status}: ${r.body?.message ?? "request failed"}`.slice(0, 300) };
    } catch (error) {
      return failure(error);
    }
  }
}

/** Picks the provider from WHATSAPP_PROVIDER (log | meta | interakt | gupshup). Credentials come from env only. */
export function createProvider(env: WhatsAppEnv): WhatsAppProvider {
  switch (env.provider) {
    case "meta":
      return new MetaCloudProvider(env);
    case "interakt":
      return new InteraktProvider(env);
    case "gupshup":
      return new GupshupProvider(env);
    default:
      return new LogProvider();
  }
}
