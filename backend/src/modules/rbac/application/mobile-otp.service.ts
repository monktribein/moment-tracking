import { BadRequestException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { SqlService } from "../../../database/sql/sql.service";
import { generateOtp, hashOtp, matchesOtp, otpPolicy, otpUsable } from "../../../common/eco/otp";
import { WhatsAppService } from "../../notifications/application/whatsapp.service";

export type MobileOtpPurpose = "register" | "reset_password";

/** One-time codes for a mobile number (customer registration, password reset). Hash only; 10-minute expiry, 5 tries, 3 sends an hour. */
@Injectable()
export class MobileOtpService {
  private readonly policy = otpPolicy();

  constructor(
    private readonly sql: SqlService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  async issue(companyId: string, mobile: string, purpose: MobileOtpPurpose): Promise<{ delivered: boolean }> {
    const p = this.policy;
    const otp = generateOtp(p.length);
    const otpHash = await hashOtp(otp, p.bcryptRounds);
    const id = await this.sql.tx(async (db) => {
      const recent = await db.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM leads.mobile_otps WHERE mobile = $1 AND purpose = $2 AND created_at > now() - interval '1 hour'`,
        [mobile, purpose],
      );
      if ((recent?.n ?? 0) >= p.maxSendsPerHour) throw new HttpException(`Too many codes requested. Try again in an hour.`, HttpStatus.TOO_MANY_REQUESTS);
      await db.exec(`UPDATE leads.mobile_otps SET invalidated_at = now() WHERE mobile = $1 AND purpose = $2 AND verified_at IS NULL AND invalidated_at IS NULL`, [mobile, purpose]);
      const row = await db.one<{ id: string }>(
        `INSERT INTO leads.mobile_otps (company_id, mobile, purpose, otp_hash, expires_at, max_attempts)
         VALUES ($1, $2, $3, $4, now() + ($5::double precision * interval '1 minute'), $6) RETURNING id`,
        [companyId, mobile, purpose, otpHash, p.ttlMinutes, p.maxAttempts],
      );
      return row!.id;
    });
    const sent = await this.whatsapp.notify({ companyId, event: purpose === "register" ? "registration_otp" : "password_reset_otp", mobile, otp, entity: "mobile_otp", entityId: id });
    const delivered = sent.status === "sent";
    await this.sql.exec(`UPDATE leads.mobile_otps SET delivery_status = $2 WHERE id = $1`, [id, delivered ? "sent" : "failed"]);
    return { delivered };
  }

  /** Checks a code. Every wrong guess counts, even though the request then fails. */
  async verify(mobile: string, purpose: MobileOtpPurpose, otp: string): Promise<{ companyId: string }> {
    const outcome = await this.sql.tx(async (db) => {
      const row = await db.one<any>(
        `SELECT * FROM leads.mobile_otps WHERE mobile = $1 AND purpose = $2 AND verified_at IS NULL AND invalidated_at IS NULL FOR UPDATE`,
        [mobile, purpose],
      );
      if (!row) return { result: "none" as const };
      const state = otpUsable(row);
      if (state !== "ok") return { result: state };
      const match = await matchesOtp(otp, row.otpHash);
      await db.exec(`UPDATE leads.mobile_otps SET attempts = attempts + 1, verified_at = ${match ? "now()" : "NULL"} WHERE id = $1`, [row.id]);
      return match ? { result: "match" as const, companyId: row.companyId as string } : { result: "wrong" as const };
    });
    if (outcome.result === "match") return { companyId: outcome.companyId! };
    const message: Record<string, string> = {
      none: "No code was requested for this number. Request a new one.",
      expired: "This code has expired. Request a new one.",
      locked: "Too many wrong attempts. Request a new code.",
      used: "This code was already used. Request a new one.",
      undelivered: "The code could not be delivered. Request a new one.",
      wrong: "The code is incorrect.",
    };
    throw new BadRequestException(message[outcome.result]);
  }
}
