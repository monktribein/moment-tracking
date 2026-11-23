/**
 * Whole-API check on a brand-new, empty Postgres (npm run test:pg):
 *   - database/migrate.js builds the schema from nothing and database/verify.js accepts it,
 *   - the API boots against it (its startup schema check passes) and creates the Super Admin,
 *   - the Super Admin manages field agents and leads, and sees attendance and tracking,
 *   - field agents sign in, check in, send GPS fixes and add leads,
 *   - admin and field-agent tokens are never accepted in each other's place.
 * Uses only made-up people and coordinates.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

const BACKEND = path.resolve(__dirname, "..");
const ADMIN = { email: "owner@example.test", password: "First-Pass-1234", name: "Test Owner" };
const AGENT = { name: "Test Agent", phone: "9876500001", password: "Agent-Pass-1", state: "Uttar Pradesh", district: "Mathura" };
const POINT = { lat: 27.5, lng: 77.68, accuracy: 8 };

describe("Movement Tracking API on a fresh database (real Postgres)", () => {
  let app: INestApplication;
  let dbName = "";
  let dbUrl = "";
  let migrateOutput = "";
  let verifyOutput = "";
  let adminToken = "";
  let agentToken = "";
  let agentId = "";

  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) => req.set("Authorization", `Bearer ${adminToken}`);
  const asAgent = (req: request.Test) => req.set("Authorization", `Bearer ${agentToken}`);
  const ok = (res: request.Response) => {
    if (res.status >= 300) throw new Error(`${res.status}: ${JSON.stringify(res.body)}`);
    return res;
  };
  const tool = (script: string) =>
    execFileSync(process.execPath, [`database/${script}`], {
      cwd: BACKEND,
      env: { ...process.env, SUPABASE_DB_URL: dbUrl, SUPABASE_MIGRATION_URL: dbUrl },
      encoding: "utf8",
    });

  beforeAll(async () => {
    const adminUrl = process.env.PG_TEST_URL;
    if (!adminUrl) throw new Error("PG_TEST_URL is not set (run with: npm run test:pg)");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client } = require("pg");
    dbName = `mt_test_${randomBytes(5).toString("hex")}`;
    const client = new Client({ connectionString: adminUrl });
    await client.connect();
    await client.query(`CREATE DATABASE ${dbName}`);
    await client.end();
    dbUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);

    migrateOutput = tool("migrate.js");
    verifyOutput = tool("verify.js");

    // process.env wins over backend/.env, so the real .env values never reach this test.
    Object.assign(process.env, {
      NODE_ENV: "test",
      SUPABASE_DB_URL: dbUrl,
      SUPABASE_TTL_SWEEP: "false",
      JWT_SECRET: "test-admin-secret-with-at-least-32-characters",
      LEAD_JWT_SECRET: "test-agent-secret-with-at-least-32-characters",
      SUPER_ADMIN_EMAIL: ADMIN.email,
      SUPER_ADMIN_PASSWORD: ADMIN.password,
      SUPER_ADMIN_NAME: ADMIN.name,
      ADMIN_BCRYPT_ROUNDS: "4",
      LEAD_BCRYPT_ROUNDS: "4",
      LEAD_AUTO_CHECKOUT_ENABLED: "false",
      CLOUDINARY_CLOUD_NAME: "",
      CLOUDINARY_API_KEY: "",
      CLOUDINARY_API_SECRET: "",
      CORS_ORIGINS: "",
      DNS_SERVERS: "",
    });
    const { configureDatabase } = await import("../src/database/database");
    configureDatabase();
    const { AppModule } = await import("../src/app.module");
    const { ApiExceptionFilter } = await import("../src/common/filters/api-exception.filter");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    const { closePostgresDriver } = await import("../src/database/pg/pg-driver");
    await closePostgresDriver();
    const adminUrl = process.env.PG_TEST_URL;
    if (adminUrl && dbName) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Client } = require("pg");
      const client = new Client({ connectionString: adminUrl });
      await client.connect();
      await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await client.end();
    }
  });

  it("builds the schema from an empty database with the project's own tools", () => {
    expect(migrateOutput).toContain("applied 0001_initial_schema.sql");
    expect(verifyOutput).toContain("schema OK: 6 tables");
    expect(verifyOutput).toContain("migrations OK");
    expect(tool("migrate.js")).toContain("Database is up to date.");
  });

  it("reports healthy once the database answers", async () => {
    const res = ok(await http().get("/api/health"));
    expect(res.body.data.checks.database).toBe(true);
  });

  it("refuses the admin API without a token", async () => {
    await http().get("/api/lead-collection/admin/leads").expect(401);
  });

  it("creates the Super Admin at startup, who can sign in", async () => {
    await http().post("/api/auth/login").send({ email: ADMIN.email, password: "wrong-password" }).expect(401);
    const res = ok(await http().post("/api/auth/login").send({ email: ADMIN.email.toUpperCase(), password: ADMIN.password }));
    adminToken = res.body.data.token;
    expect(res.body.data.admin).toMatchObject({ email: ADMIN.email, name: ADMIN.name, role: "super_admin", status: "active" });
    expect(res.body.data.admin.passwordHash).toBeUndefined();
    const me = ok(await asAdmin(http().get("/api/auth/me")));
    expect(me.body.data).toMatchObject({ email: ADMIN.email, role: "super_admin" });
  });

  it("never creates a second Super Admin or resets the first from .env", async () => {
    const { AdminAuthService } = await import("../src/modules/super-admin/application/admin-auth.service");
    process.env.SUPER_ADMIN_EMAIL = "someone-else@example.test";
    process.env.SUPER_ADMIN_PASSWORD = "Another-Pass-1234";
    await app.get(AdminAuthService).onApplicationBootstrap();
    await http().post("/api/auth/login").send({ email: "someone-else@example.test", password: "Another-Pass-1234" }).expect(401);
    ok(await http().post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password }));
  });

  it("lets the Super Admin create a field agent in a built-in region", async () => {
    const regions = ok(await asAdmin(http().get("/api/lead-collection/admin/regions")));
    expect(regions.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ state: AGENT.state, district: AGENT.district })]));
    const created = ok(await asAdmin(http().post("/api/lead-collection/admin/users")).send(AGENT));
    agentId = String(created.body.data._id);
    expect(agentId).toMatch(/^[0-9a-f]{24}$/);
    expect(created.body.data.passwordHash).toBeUndefined();
    expect(created.body.data.createdByAdminName).toBe(ADMIN.name);
    const list = ok(await asAdmin(http().get("/api/lead-collection/admin/users")));
    expect(JSON.stringify(list.body.data)).toContain(AGENT.phone);
  });

  it("lets the field agent sign in, and keeps the two kinds of token apart", async () => {
    const res = ok(await http().post("/api/lead-collection/auth/login").send({ phone: AGENT.phone, password: AGENT.password }));
    agentToken = res.body.data.token;
    expect(res.body.data.user).toMatchObject({ name: AGENT.name, district: AGENT.district });
    await asAgent(http().get("/api/lead-collection/admin/leads")).expect(401);
    await asAgent(http().get("/api/auth/me")).expect(401);
    await asAdmin(http().get("/api/lead-collection/agent/attendance/today")).expect(401);
  });

  it("records the agent's consent, check-in, GPS fixes and a new lead", async () => {
    ok(await asAgent(http().post("/api/lead-collection/agent/tracking/consent")).send({ granted: true, deviceLabel: "test phone" }));
    ok(await asAgent(http().post("/api/lead-collection/agent/attendance/check-in")).send({ coords: POINT, address: "Test Road" }));
    const fixes = ok(
      await asAgent(http().post("/api/lead-collection/agent/tracking/fixes")).send({
        fixes: [{ ...POINT, recordedAt: new Date().toISOString(), source: "foreground" }],
      }),
    );
    expect(fixes.body.data.accepted).toBe(1);
    ok(
      await asAgent(http().post("/api/lead-collection/agent/leads")).send({
        name: "Test Guest House",
        location: { address: "Test Road", city: AGENT.district, district: AGENT.district, state: AGENT.state },
        contact: { ownerName: "Test Owner", phone: "9876500002" },
        interest: "Interested",
      }),
    );
  });

  it("shows the Super Admin the lead, the attendance and the live position", async () => {
    const leads = ok(await asAdmin(http().get("/api/lead-collection/admin/leads")));
    const lead = (leads.body.data.items ?? leads.body.data.data ?? leads.body.data).find((l: any) => l.name === "Test Guest House");
    expect(lead).toBeDefined();
    ok(await asAdmin(http().post(`/api/lead-collection/admin/leads/${lead._id ?? lead.id}/approve`)).send({ note: "Looks good" }));
    ok(await asAdmin(http().get("/api/lead-collection/admin/leads/stats")));
    ok(await asAdmin(http().get("/api/lead-collection/admin/attendance/summary")));
    ok(await asAdmin(http().get(`/api/lead-collection/admin/attendance/agent/${agentId}`)));
    ok(await asAdmin(http().get(`/api/lead-collection/admin/agents/${agentId}/tracking`)));
    const live = ok(await asAdmin(http().get("/api/lead-collection/admin/tracking/live")));
    expect(JSON.stringify(live.body.data)).toContain(agentId);
  });

  it("signs out every old Super Admin session when the password changes", async () => {
    const oldToken = adminToken;
    await asAdmin(http().post("/api/auth/change-password")).send({ currentPassword: "wrong", newPassword: "Second-Pass-5678" }).expect(400);
    const res = ok(await asAdmin(http().post("/api/auth/change-password")).send({ currentPassword: ADMIN.password, newPassword: "Second-Pass-5678" }));
    adminToken = res.body.data.token;
    await http().get("/api/auth/me").set("Authorization", `Bearer ${oldToken}`).expect(401);
    ok(await asAdmin(http().get("/api/auth/me")));
    await http().post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password }).expect(401);
    ok(await http().post("/api/auth/login").send({ email: ADMIN.email, password: "Second-Pass-5678" }));
  });
});
