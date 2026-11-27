import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { nodePgPool, type PgPool, type Queryable } from "../pg/pool";

export type Row = Record<string, any>;

const camelKey = (key: string): string => key.replace(/_+([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** snake_case columns -> camelCase keys (top level only: jsonb values are returned as stored). */
export const camelRow = <T = Row>(row: Row): T => {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "_nulls" || key === "_extra") continue;
    out[camelKey(key)] = value;
  }
  return out as T;
};

/** A connection (or transaction) the services run SQL on. */
export class Db {
  constructor(private readonly target: Queryable) {}

  async all<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.target.query(sql, params);
    return result.rows.map((row) => camelRow<T>(row));
  }

  async one<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.all<T>(sql, params))[0] ?? null;
  }

  async exec(sql: string, params: unknown[] = []): Promise<number> {
    return (await this.target.query(sql, params)).rowCount ?? 0;
  }
}

/**
 * Raw SQL access to the SQL-managed Eco Sor tables (migrations 0004+). The lead
 * models keep using the model layer; these tables need real transactions, row
 * locks and partial unique indexes, so they are queried directly. Same
 * database and same SUPABASE_DB_URL as the rest of the API.
 */
@Injectable()
export class SqlService extends Db implements OnModuleDestroy {
  private readonly pool: PgPool;

  constructor() {
    const url = process.env.SUPABASE_DB_URL;
    if (!url) throw new Error("SUPABASE_DB_URL is required");
    const pool = nodePgPool(url, {
      max: Number(process.env.ECO_PG_POOL_MAX) > 0 ? Number(process.env.ECO_PG_POOL_MAX) : 5,
      applicationName: "movement-tracking-eco",
    });
    super(pool);
    this.pool = pool;
  }

  /** Runs `fn` in one transaction; rolls back on any error. Use `FOR UPDATE` inside for row locks. */
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(new Db(client));
      await client.query("COMMIT");
      client.release();
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}
