import { BadRequestException } from "@nestjs/common";
import type { Db } from "../../database/sql/sql.service";

/**
 * Idempotent creates for the mobile apps (Idempotency-Key header). The key is kept in the row's
 * `_extra` column, so no schema change is needed; a transaction-scoped advisory lock makes two
 * copies of the same request run one after the other, so the second finds the first row.
 */
export const checkIdempotencyKey = (key: string | undefined): string | undefined => {
  const k = key?.trim();
  if (!k) return undefined;
  if (k.length < 8 || k.length > 128) throw new BadRequestException("Idempotency-Key must be 8 to 128 characters");
  return k;
};

/** Returns the id already created for (table, owner, key), or null. Call inside the create transaction, before inserting. */
export async function findIdempotent(db: Db, table: string, ownerColumn: string, owner: string, key: string | undefined): Promise<string | null> {
  if (!key) return null;
  await db.exec(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${table}:${owner}:${key}`]);
  const row = await db.one<{ id: string }>(`SELECT id FROM leads.${table} WHERE ${ownerColumn} = $1 AND _extra->>'idempotencyKey' = $2 LIMIT 1`, [owner, key]);
  return row?.id ?? null;
}

/** Records the key on the row just created. */
export async function rememberIdempotent(db: Db, table: string, id: string, key: string | undefined): Promise<void> {
  if (!key) return;
  await db.exec(`UPDATE leads.${table} SET _extra = coalesce(_extra, '{}'::jsonb) || jsonb_build_object('idempotencyKey', $2::text) WHERE id = $1`, [id, key]);
}
