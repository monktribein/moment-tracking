import { BadRequestException, ConflictException } from "@nestjs/common";

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export const ok = <T>(data: T) => ({ success: true, data });

export const paged = <T>(items: T[], page: number, limit: number, total: number) => ({
  success: true,
  data: items,
  meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } satisfies PageMeta,
});

/** Today's date (YYYY-MM-DD) in India, where every Eco Sor day starts. */
export const todayIst = (): string => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Maps a Postgres unique/check/foreign-key violation to a clear 4xx instead of a 500. */
export const translateDbError = (error: unknown, fallback = "That record conflicts with an existing one"): never => {
  const e = error as { code?: string; constraint?: string };
  if (e?.code === "23505") throw new ConflictException(fallback);
  if (e?.code === "23503") throw new BadRequestException("A linked record does not exist or is still in use");
  if (e?.code === "23514") throw new BadRequestException(`Rejected by a data rule${e.constraint ? ` (${e.constraint})` : ""}`);
  if (e?.code === "22P02" || e?.code === "22007" || e?.code === "22008") throw new BadRequestException("A value is not in a valid format");
  throw error;
};

/** Runs `fn`; Postgres rule violations become 4xx responses. */
export async function guarded<T>(fn: () => Promise<T>, conflict?: string): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    return translateDbError(error, conflict);
  }
}

/** A 24-hex record id (the shape of every id in the database). */
export const isId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{24}$/i.test(value);

export const addDays = (day: string, n: number): string => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
