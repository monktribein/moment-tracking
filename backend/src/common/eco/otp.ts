import { randomInt } from "node:crypto";
import { compare, hash } from "bcryptjs";

export interface OtpPolicy {
  length: number;
  ttlMinutes: number;
  maxAttempts: number;
  maxSendsPerHour: number;
  bcryptRounds: number;
}

/** OTP_* settings; defaults follow the SRS: 6 digits, 10 minutes, 5 attempts, 3 sends an hour. */
export const otpPolicy = (env: NodeJS.ProcessEnv = process.env): OtpPolicy => {
  const n = (v: string | undefined, d: number) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    length: n(env.OTP_LENGTH, 6),
    ttlMinutes: n(env.OTP_TTL_MINUTES, 10),
    maxAttempts: n(env.OTP_MAX_ATTEMPTS, 5),
    maxSendsPerHour: n(env.OTP_MAX_SENDS_PER_HOUR, 3),
    bcryptRounds: n(env.OTP_BCRYPT_ROUNDS, 8),
  };
};

export const generateOtp = (length = 6): string => String(randomInt(0, 10 ** length)).padStart(length, "0");

export const hashOtp = (otp: string, rounds = 8): Promise<string> => hash(otp, rounds);
export const matchesOtp = (otp: string, otpHash: string): Promise<boolean> => compare(otp, otpHash);

export interface OtpState {
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  verifiedAt: Date | null;
  invalidatedAt: Date | null;
  deliveryStatus: string;
}

/** Whether a stored OTP may still be tried. Pure, so the rules are unit-tested. */
export function otpUsable(state: OtpState, now = new Date()): "ok" | "expired" | "locked" | "used" | "undelivered" {
  if (state.verifiedAt || state.invalidatedAt) return "used";
  if (state.deliveryStatus === "failed") return "undelivered";
  if (state.expiresAt.getTime() <= now.getTime()) return "expired";
  if (state.attempts >= state.maxAttempts) return "locked";
  return "ok";
}
