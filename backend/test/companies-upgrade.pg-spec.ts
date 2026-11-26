/**
 * Upgrading a database that already holds data from before companies
 * (npm run test:pg). Migration 0003 must put every existing row in one
 * "Default company", so the existing Super Admin and staff keep signing in and
 * keep seeing exactly their own data, and the platform owner sees that company.
 * Uses only made-up people and coordinates.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { hashSync } from "bcryptjs";
import request from "supertest";

const BACKEND = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(BACKEND, "database/migrations");
const DEFAULT_COMPANY = "6b07d9dc9494770d72415ee9";
const OWNER = { email: "platform@example.test", password: "Owner-Pass-1234", name: "Test Platform Owner" };
const OLD_ADMIN = { id: "64b7f3a1c2d4e5f6a7b8c901", email: "old-admin@example.test", password: "Old-Admin-Pass-1" };
const OLD_AGENT = { id: "64b7f3a1c2d4e5f6a7b8c902", phone: "9876500021", password: "Old-Agent-Pass-1" };
const OLD_LEAD = "64b7f3a1c2d4e5f6a7b8c903";
const TABLES = ["admin_users", "lead_users", "leads", "lead_regions", "lead_attendances", "lead_location_pings"];

describe("Upgrading a database from before companies (real Postgres)", () => {
  let app: INestApplication;
  let dbName = "";
  let dbUrl = "";
  let migrateOutput = "";
  let db: any;

  const http = () => request(app.getHttpServer());
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
    dbName = `mt_upgrade_${randomBytes(5).toString("hex")}`;
    const server = new Client({ connectionString: adminUrl });
    await server.connect();
    await server.query(`CREATE DATABASE ${dbName}`);
    await server.end();
    dbUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);

    // The database as it was deployed before companies: 0001 and 0002 applied and recorded.
    db = new Client({ connectionString: dbUrl });
    await db.connect();
    for (const file of ["0001_initial_schema.sql", "0002_table_comments.sql"])
      await db.query(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
    await db.query("CREATE TABLE public.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    await db.query("INSERT INTO public.schema_migrations (name) VALUES ('0001_initial_schema.sql'), ('0002_table_comments.sql')");

    // Data from that time: one Super Admin, a field agent, a lead, a custom region, a shift and a GPS point.
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    await db.query(
      `INSERT INTO leads.admin_users (id, name, email, password_hash, role, status, token_version, created_at, updated_at)
       VALUES ($1, 'Old Admin', $2, $3, 'super_admin', 'active', 0, now(), now())`,
      [OLD_ADMIN.id, OLD_ADMIN.email, hashSync(OLD_ADMIN.password, 4)],
    );
    await db.query(
      `INSERT INTO leads.lead_users (id, name, phone, email, password_hash, role, status, region, state, district,
         employee_code, notes, token_version, created_by_admin_id, created_by_admin_name, tracking_consent, created_at, updated_at, version)
       VALUES ($1, 'Old Agent', $2, '', $3, 'field_agent', 'active', 'Mathura, Uttar Pradesh', 'Uttar Pradesh', 'Mathura',
         '', '', 0, $4, 'Old Admin', '{"granted": false}', now(), now(), 0)`,
      [OLD_AGENT.id, OLD_AGENT.phone, hashSync(OLD_AGENT.password, 4), OLD_ADMIN.id],
    );
    await db.query(
      `INSERT INTO leads.leads (id, name, location, contact, meeting, images, interest, status, captured_by, captured_by_name,
         captured_at, reviewed_by_admin_id, reviewed_by_admin_name, review_note, created_at, updated_at, version)
       VALUES ($1, 'Old Guest House', '{"address": "Old Road", "city": "Mathura", "district": "Mathura", "state": "Uttar Pradesh"}',
         '{"ownerName": "Old Host", "phone": "9876500022"}', '{"requested": false, "time": "", "mode": ""}', '[]',
         'Interested', 'pending', $2, 'Old Agent', now(), '', '', '', now(), now(), 0)`,
      [OLD_LEAD, OLD_AGENT.id],
    );
    await db.query(
      `INSERT INTO leads.lead_regions (id, state, district, created_by_admin_id, created_by_admin_name, created_at, updated_at)
       VALUES ('64b7f3a1c2d4e5f6a7b8c904', 'Rajasthan', 'Jaipur', $1, 'Old Admin', now(), now())`,
      [OLD_ADMIN.id],
    );
    await db.query(
      `INSERT INTO leads.lead_attendances (id, agent_id, agent_name, date, checked_in, check_in_time, checked_out, status, created_at, updated_at, version)
       VALUES ('64b7f3a1c2d4e5f6a7b8c905', $1, 'Old Agent', $2, true, now(), false, 'checked_in', now(), now(), 0)`,
      [OLD_AGENT.id, day],
    );
    await db.query(
      `INSERT INTO leads.lead_location_pings (id, agent_id, agent_name, state, district, date, lat, lng, recorded_at,
         metres_from_previous, source, created_at, updated_at)
       VALUES ('64b7f3a1c2d4e5f6a7b8c906', $1, 'Old Agent', 'Uttar Pradesh', 'Mathura', $2, 27.5, 77.68, now(), 0, 'foreground', now(), now())`,
      [OLD_AGENT.id, new Date().toISOString().slice(0, 10)],
    );

    migrateOutput = tool("migrate.js");

    Object.assign(process.env, {
      NODE_ENV: "test",
      SUPABASE_DB_URL: dbUrl,
      SUPABASE_TTL_SWEEP: "false",
      JWT_SECRET: "test-admin-secret-with-at-least-32-characters",
      LEAD_JWT_SECRET: "test-agent-secret-with-at-least-32-characters",
      PLATFORM_OWNER_EMAIL: OWNER.email,
      PLATFORM_OWNER_PASSWORD: OWNER.password,
      PLATFORM_OWNER_NAME: OWNER.name,
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
    await db?.end();
    const { closePostgresDriver } = await import("../src/database/pg/pg-driver");
    await closePostgresDriver();
    const adminUrl = process.env.PG_TEST_URL;
    if (adminUrl && dbName) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Client } = require("pg");
      const server = new Client({ connectionString: adminUrl });
      await server.connect();
      await server.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await server.end();
    }
  });

  it("applies only the new migration and moves every existing row into one Default company", async () => {
    expect(migrateOutput).toContain("applied 0003_companies.sql");
    expect(migrateOutput).not.toContain("0001_initial_schema.sql");
    expect(tool("verify.js")).toContain("migrations OK");

    const companies = (await db.query("SELECT id, name, status FROM leads.companies")).rows;
    expect(companies).toEqual([{ id: DEFAULT_COMPANY, name: "Default company", status: "active" }]);
    for (const table of TABLES) {
      // The platform owner (created at startup) is the one console account with no company.
      const scope = table === "admin_users" ? `AND role = 'super_admin'` : "";
      const { rows } = await db.query(
        `SELECT count(*)::int AS n, count(*) FILTER (WHERE company_id IS DISTINCT FROM $1)::int AS outside
           FROM leads.${table} WHERE true ${scope}`,
        [DEFAULT_COMPANY],
      );
      expect({ table, rows: rows[0].n, outside: rows[0].outside }).toEqual({ table, rows: 1, outside: 0 });
    }
    expect((await db.query("SELECT role, company_id FROM leads.admin_users WHERE role = 'platform_owner'")).rows).toEqual([
      { role: "platform_owner", company_id: null },
    ]);
    // The old platform-wide region index is gone; the per-company one replaces it.
    expect((await db.query("SELECT to_regclass('leads.lead_regions_uq_dd49a283') AS t")).rows[0].t).toBeNull();
    expect(tool("migrate.js")).toContain("Database is up to date.");
  });

  it("lets the existing Super Admin and field agent carry on with their own data", async () => {
    const res = ok(await http().post("/api/auth/login").send({ email: OLD_ADMIN.email, password: OLD_ADMIN.password }));
    expect(res.body.data.admin).toMatchObject({
      role: "super_admin",
      companyId: DEFAULT_COMPANY,
      company: { id: DEFAULT_COMPANY, name: "Default company", status: "active" },
    });
    const asAdmin = (req: request.Test) => req.set("Authorization", `Bearer ${res.body.data.token}`);
    const admin = "/api/lead-collection/admin";

    expect(ok(await asAdmin(http().get(`${admin}/users`))).body.data.items.map((u: any) => String(u._id))).toEqual([OLD_AGENT.id]);
    expect(ok(await asAdmin(http().get(`${admin}/leads`))).body.data.items.map((l: any) => String(l._id))).toEqual([OLD_LEAD]);
    expect(ok(await asAdmin(http().get(`${admin}/regions`))).body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ district: "Jaipur", source: "custom" })]),
    );
    expect(Object.keys(ok(await asAdmin(http().get(`${admin}/attendance/summary`))).body.data.todayMap)).toEqual([OLD_AGENT.id]);
    expect(JSON.stringify(ok(await asAdmin(http().get(`${admin}/tracking/live`))).body.data)).toContain(OLD_AGENT.id);

    // New records join the same company.
    const added = ok(
      await asAdmin(http().post(`${admin}/users`)).send({
        name: "New Agent",
        phone: "9876500023",
        password: "New-Agent-Pass-1",
        state: "Rajasthan",
        district: "Jaipur",
      }),
    );
    expect(added.body.data.companyId).toBe(DEFAULT_COMPANY);

    const agent = ok(await http().post("/api/lead-collection/auth/login").send({ phone: OLD_AGENT.phone, password: OLD_AGENT.password }));
    expect(agent.body.data.user.companyId).toBe(DEFAULT_COMPANY);
    const leads = ok(
      await http().get("/api/lead-collection/agent/leads").set("Authorization", `Bearer ${agent.body.data.token}`),
    );
    expect(leads.body.data.items.map((l: any) => String(l._id))).toEqual([OLD_LEAD]);
  });

  it("shows the platform owner the Default company, which they can rename", async () => {
    const owner = ok(await http().post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }));
    const asOwner = (req: request.Test) => req.set("Authorization", `Bearer ${owner.body.data.token}`);
    const list = ok(await asOwner(http().get("/api/platform/companies"))).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: DEFAULT_COMPANY, name: "Default company", counts: { superAdmins: 1, staff: 2, activeStaff: 2, leads: 1 } });
    const renamed = ok(await asOwner(http().put(`/api/platform/companies/${DEFAULT_COMPANY}`)).send({ name: "First Customer Ltd" }));
    expect(renamed.body.data.name).toBe("First Customer Ltd");
    const me = ok(await http().post("/api/auth/login").send({ email: OLD_ADMIN.email, password: OLD_ADMIN.password }));
    expect(me.body.data.admin.company.name).toBe("First Customer Ltd");
  });
});
