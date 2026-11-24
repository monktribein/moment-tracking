/**
 * Storage: Supabase Postgres, reached through the model-layer storage driver in
 * ./pg. Must run before Nest creates any model connection (main.ts and
 * the CLI scripts call it first). Models, hooks and services use the model layer
 * (./orm) for data mapping; every read and write goes to Postgres.
 */
import { REGISTRY } from "./pg/registry.generated";
import { enablePostgresDriver } from "./pg/pg-driver";

/**
 * Logical database name of the one model connection (the lead connection). It
 * maps to the Postgres schema "leads" (see the registry). Only the code uses this
 * name; the tables themselves live in schema "leads".
 */
export const LEAD_DATABASE = "movement_tracking";

/**
 * The connection string the model layer is given. The Postgres driver ignores it —
 * it uses the pool built from SUPABASE_DB_URL — so it never carries secrets.
 */
export const DRIVER_URI = "postgres://supabase";

export function configureDatabase(env: NodeJS.ProcessEnv = process.env): void {
  const url = env.SUPABASE_DB_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is required (Supabase Session pooler URL, port 5432)");
  const poolMax = Number(env.SUPABASE_POOL_MAX);
  enablePostgresDriver({
    connectionString: url,
    registry: REGISTRY,
    poolMax: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 10,
    ttlSweep: env.SUPABASE_TTL_SWEEP !== "false",
    verifySchema: env.SUPABASE_VERIFY_SCHEMA !== "false",
  });
}
