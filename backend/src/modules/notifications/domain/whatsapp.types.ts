/** WhatsApp events (SRS section 14). The template name sent to the provider defaults to the event key. */
export const WHATSAPP_EVENTS = [
  "distributor_account_activated",
  "request_submitted",
  "request_received",
  "payment_verified",
  "payment_rejected",
  "correction_required",
  "request_approved",
  "request_rejected",
  "request_processed",
  "complaint_registered",
  "complaint_status_changed",
  "complaint_closed",
  "engineer_assigned",
  "service_otp",
  "registration_otp",
  "password_reset_otp",
] as const;
export type WhatsAppEvent = (typeof WHATSAPP_EVENTS)[number];

export interface OutboundMessage {
  /** Digits with country code, no plus sign (e.g. 919876543210). */
  to: string;
  template: string;
  language: string;
  /** Ordered template variables ({{1}}, {{2}} ...). */
  params: string[];
  /** The secret code in an OTP/authentication template (never stored in whatsapp_logs). */
  otp?: string;
}

export interface SendResult {
  ok: boolean;
  providerMsgId?: string;
  error?: string;
}

/** A WhatsApp Business provider adapter. */
export interface WhatsAppProvider {
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
}
