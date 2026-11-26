import { setServers } from "node:dns";

const integer = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) ? parsed : fallback;
};

const boolean = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : value.toLowerCase() === "true";

const csv = (value: string | undefined, fallback: string): string[] =>
  (value ?? fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Settings read through ConfigService. The field-agent (lead) settings —
 * LEAD_JWT_*, LEAD_BCRYPT_ROUNDS, LEAD_AUTO_CHECKOUT_ENABLED — are read by
 * modules/lead-collection itself (see its config/lead-collection.config.ts).
 */
export interface Environment {
  nodeEnv: string;
  host: string;
  port: number;
  corsOrigins: string[];
  trustProxy: boolean;
  swaggerEnabled: boolean;
  logLevel: string;
  dnsServers: string[];
  throttleTtlMs: number;
  throttleLimit: number;
  throttleIpAbuseTtlMs: number;
  throttleIpAbuseLimit: number;
  supabaseDbUrl: string;
  supabasePoolMax: number;
  supabaseTtlSweep: boolean;
  /** Super Admin console tokens. */
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtIssuer: string;
  jwtAudience: string;
  adminBcryptRounds: number;
  /**
   * The platform owner (higher authority), created at startup only while no
   * platform owner exists. It creates companies and their Super Admins.
   */
  platformOwnerEmail: string;
  platformOwnerName: string;
  platformOwnerPassword: string;
  cloudinaryCloudName: string;
  cloudinaryApiKey: string;
  cloudinaryApiSecret: string;
  cloudinaryFolder: string;
}

export const applyDnsServersFromEnvironment = (): string[] => {
  const servers = csv(process.env.DNS_SERVERS, "");
  if (servers.length > 0) setServers(servers);
  return servers;
};

export const environment = (): Environment => ({
  nodeEnv: process.env.NODE_ENV ?? "development",
  host: process.env.HOST ?? "0.0.0.0",
  port: integer(process.env.PORT, 5100),
  corsOrigins: csv(process.env.CORS_ORIGINS, ""),
  trustProxy: boolean(process.env.TRUST_PROXY, false),
  swaggerEnabled: boolean(process.env.SWAGGER_ENABLED, process.env.NODE_ENV !== "production"),
  logLevel: process.env.LOG_LEVEL ?? "info",
  dnsServers: csv(process.env.DNS_SERVERS, ""),
  throttleTtlMs: integer(process.env.THROTTLE_TTL_MS, 60_000),
  throttleLimit: integer(process.env.THROTTLE_LIMIT, 120),
  throttleIpAbuseTtlMs: integer(process.env.THROTTLE_IP_ABUSE_TTL_MS, 60_000),
  throttleIpAbuseLimit: integer(process.env.THROTTLE_IP_ABUSE_LIMIT, 30_000),
  supabaseDbUrl: process.env.SUPABASE_DB_URL ?? "",
  supabasePoolMax: integer(process.env.SUPABASE_POOL_MAX, 10),
  supabaseTtlSweep: process.env.SUPABASE_TTL_SWEEP !== "false",
  jwtSecret: process.env.JWT_SECRET ?? "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "12h",
  jwtIssuer: process.env.JWT_ISSUER ?? "movement-tracking-api",
  jwtAudience: process.env.JWT_AUDIENCE ?? "movement-tracking-admin",
  adminBcryptRounds: integer(process.env.ADMIN_BCRYPT_ROUNDS, 12),
  platformOwnerEmail: process.env.PLATFORM_OWNER_EMAIL ?? "",
  platformOwnerName: process.env.PLATFORM_OWNER_NAME ?? "Platform Owner",
  platformOwnerPassword: process.env.PLATFORM_OWNER_PASSWORD ?? "",
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY ?? "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  cloudinaryFolder: process.env.CLOUDINARY_FOLDER ?? "movement-tracking",
});

const requireTogether = (input: Record<string, unknown>, names: string[]): void => {
  const present = names.filter((name) => String(input[name] ?? "").trim());
  if (present.length > 0 && present.length < names.length)
    throw new Error(`${names.join(", ")} must be configured together`);
};

export function validateEnvironment(input: Record<string, unknown>): Record<string, unknown> {
  const nodeEnv = String(input.NODE_ENV ?? "development");
  if (!["development", "test", "production"].includes(nodeEnv))
    throw new Error("NODE_ENV must be development, test, or production");

  for (const name of [
    "PORT",
    "SUPABASE_POOL_MAX",
    "THROTTLE_TTL_MS",
    "THROTTLE_LIMIT",
    "THROTTLE_IP_ABUSE_TTL_MS",
    "THROTTLE_IP_ABUSE_LIMIT",
    "ADMIN_BCRYPT_ROUNDS",
    "LEAD_BCRYPT_ROUNDS",
  ]) {
    if (input[name] !== undefined && (!Number.isInteger(Number(input[name])) || Number(input[name]) < 1))
      throw new Error(`${name} must be a positive integer`);
  }

  if (input.CORS_ORIGINS) {
    for (const origin of String(input.CORS_ORIGINS).split(",")) {
      try {
        const url = new URL(origin.trim());
        if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      } catch {
        throw new Error("CORS_ORIGINS must contain valid HTTP(S) URLs");
      }
    }
  }
  if (input.SUPABASE_DB_URL) {
    try {
      new URL(String(input.SUPABASE_DB_URL));
    } catch {
      throw new Error("SUPABASE_DB_URL must be a valid URL");
    }
  }
  if (String(input.PLATFORM_OWNER_PASSWORD ?? "") && String(input.PLATFORM_OWNER_PASSWORD).length < 10)
    throw new Error("PLATFORM_OWNER_PASSWORD must contain at least 10 characters");
  requireTogether(input, ["PLATFORM_OWNER_EMAIL", "PLATFORM_OWNER_PASSWORD"]);
  requireTogether(input, ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]);

  if (nodeEnv === "production") {
    if (String(input.JWT_SECRET ?? "").length < 32)
      throw new Error("JWT_SECRET must contain at least 32 characters in production");
    if (String(input.LEAD_JWT_SECRET ?? "").trim() && String(input.LEAD_JWT_SECRET).length < 32)
      throw new Error("LEAD_JWT_SECRET must contain at least 32 characters in production");
    if (!input.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is required in production");
    if (!String(input.CORS_ORIGINS ?? "").trim()) throw new Error("CORS_ORIGINS is required in production");
    if (String(input.CORS_ORIGINS).includes("*"))
      throw new Error("Wildcard CORS origins are not allowed in production");
  }
  return input;
}
