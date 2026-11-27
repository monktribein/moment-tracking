/**
 * Whole-API check on a brand-new, empty Postgres (npm run test:pg):
 *   - database/migrate.js builds the schema from nothing and database/verify.js accepts it,
 *   - the API boots against it (its startup schema check passes) and creates the platform owner,
 *   - the platform owner creates companies, each with its Super Admin,
 *   - a Super Admin manages their company's field agents and leads, and sees attendance and tracking,
 *   - field agents sign in, check in, send GPS fixes and add leads,
 *   - no company ever sees or changes another company's records,
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
const OWNER = { email: "platform@example.test", password: "Owner-Pass-1234", name: "Test Platform Owner" };
const ADMIN = { email: "owner@example.test", password: "First-Pass-1234", name: "Test Owner" };
const ADMIN_B = { email: "beta-admin@example.test", name: "Beta Admin" };
const AGENT = { name: "Test Agent", phone: "9876500001", password: "Agent-Pass-1", state: "Uttar Pradesh", district: "Mathura" };
const EXEC = { ...AGENT, name: "Test Executive", phone: "9876500003", password: "Exec-Pass-12", role: "lead_executive" };
const POINT = { lat: 27.5, lng: 77.68, accuracy: 8 };

describe("Movement Tracking API on a fresh database (real Postgres)", () => {
  let app: INestApplication;
  let dbName = "";
  let dbUrl = "";
  let migrateOutput = "";
  let verifyOutput = "";
  let ownerToken = "";
  let ownerId = "";
  let adminToken = "";
  let adminBToken = "";
  let adminBPassword = "";
  let companyAId = "";
  let companyBId = "";
  let agentToken = "";
  let agentId = "";
  let assignedLeadId = "";

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => (req: request.Test) => req.set("Authorization", `Bearer ${token}`);
  const asOwner = (req: request.Test) => bearer(ownerToken)(req);
  const asAdmin = (req: request.Test) => req.set("Authorization", `Bearer ${adminToken}`);
  const asAdminB = (req: request.Test) => bearer(adminBToken)(req);
  const asAgent = (req: request.Test) => req.set("Authorization", `Bearer ${agentToken}`);
  const signIn = async (who: { phone: string; password: string }) =>
    ok(await http().post("/api/lead-collection/auth/login").send({ phone: who.phone, password: who.password })).body.data
      .token as string;
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
    expect(migrateOutput).toContain("applied 0003_companies.sql");
    expect(verifyOutput).toMatch(/schema OK: \d+ tables/);
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

  it("creates the platform owner at startup, who can sign in", async () => {
    await http().post("/api/auth/login").send({ email: OWNER.email, password: "wrong-password" }).expect(401);
    const res = ok(await http().post("/api/auth/login").send({ email: OWNER.email.toUpperCase(), password: OWNER.password }));
    ownerToken = res.body.data.token;
    ownerId = res.body.data.admin.id;
    expect(res.body.data.admin).toMatchObject({
      email: OWNER.email,
      name: OWNER.name,
      role: "platform_owner",
      status: "active",
      companyId: null,
      company: null,
    });
    expect(res.body.data.admin.passwordHash).toBeUndefined();
    const me = ok(await asOwner(http().get("/api/auth/me")));
    expect(me.body.data).toMatchObject({ email: OWNER.email, role: "platform_owner" });
  });

  it("never creates a second platform owner or resets the first from .env", async () => {
    const { AdminAuthService } = await import("../src/modules/super-admin/application/admin-auth.service");
    process.env.PLATFORM_OWNER_EMAIL = "someone-else@example.test";
    process.env.PLATFORM_OWNER_PASSWORD = "Another-Pass-1234";
    await app.get(AdminAuthService).onApplicationBootstrap();
    await http().post("/api/auth/login").send({ email: "someone-else@example.test", password: "Another-Pass-1234" }).expect(401);
    ok(await http().post("/api/auth/login").send({ email: OWNER.email, password: OWNER.password }));
  });

  it("keeps the platform owner out of every company's staff, leads and tracking", async () => {
    await asOwner(http().get("/api/lead-collection/admin/leads")).expect(403);
    await asOwner(http().get("/api/lead-collection/admin/users")).expect(403);
    await asOwner(http().get("/api/lead-collection/admin/tracking/live")).expect(403);
  });

  it("lets the platform owner create companies, each with its own Super Admin", async () => {
    const created = ok(
      await asOwner(http().post("/api/platform/companies")).send({
        name: "Alpha Stays",
        contactPhone: "9000000001",
        adminName: ADMIN.name,
        adminEmail: ADMIN.email,
        adminPassword: ADMIN.password,
      }),
    );
    companyAId = created.body.data.company.id;
    expect(companyAId).toMatch(/^[0-9a-f]{24}$/);
    expect(created.body.data.company).toMatchObject({ name: "Alpha Stays", status: "active", contactPhone: "9000000001" });
    expect(created.body.data.admin).toMatchObject({ email: ADMIN.email, role: "super_admin", companyId: companyAId });
    expect(created.body.data.temporaryPassword).toBeUndefined();
    expect(JSON.stringify(created.body.data)).not.toContain("passwordHash");

    // The same company name, or an email that already has an account, is refused.
    await asOwner(http().post("/api/platform/companies"))
      .send({ name: "alpha stays", adminName: "Someone", adminEmail: "someone@example.test" })
      .expect(409);
    await asOwner(http().post("/api/platform/companies"))
      .send({ name: "Other Co", adminName: "Someone", adminEmail: ADMIN.email })
      .expect(409);
    await asOwner(http().post("/api/platform/companies"))
      .send({ name: "Other Co", adminName: "Someone", adminEmail: OWNER.email })
      .expect(409);

    // Without a password the server generates one and returns it once.
    const beta = ok(
      await asOwner(http().post("/api/platform/companies")).send({
        name: "Beta Homes",
        adminName: ADMIN_B.name,
        adminEmail: ADMIN_B.email,
      }),
    );
    companyBId = beta.body.data.company.id;
    adminBPassword = beta.body.data.temporaryPassword;
    expect(adminBPassword).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);

    // The refused attempts left nothing behind.
    const list = ok(await asOwner(http().get("/api/platform/companies")));
    expect(list.body.data.map((c: any) => c.name).sort()).toEqual(["Alpha Stays", "Beta Homes"]);
  });

  it("signs each Super Admin in to their own company, and keeps them off the platform routes", async () => {
    await http().post("/api/auth/login").send({ email: ADMIN.email, password: "wrong-password" }).expect(401);
    const res = ok(await http().post("/api/auth/login").send({ email: ADMIN.email.toUpperCase(), password: ADMIN.password }));
    adminToken = res.body.data.token;
    expect(res.body.data.admin).toMatchObject({
      email: ADMIN.email,
      name: ADMIN.name,
      role: "super_admin",
      status: "active",
      companyId: companyAId,
      company: { id: companyAId, name: "Alpha Stays", status: "active" },
    });
    const me = ok(await asAdmin(http().get("/api/auth/me")));
    expect(me.body.data).toMatchObject({ email: ADMIN.email, role: "super_admin", company: { name: "Alpha Stays" } });

    adminBToken = ok(await http().post("/api/auth/login").send({ email: ADMIN_B.email, password: adminBPassword })).body
      .data.token;

    await asAdmin(http().get("/api/platform/companies")).expect(403);
    await asAdmin(http().post("/api/platform/companies"))
      .send({ name: "Sneaky Co", adminName: "Sneaky", adminEmail: "sneaky@example.test" })
      .expect(403);
    await asAdmin(http().put(`/api/platform/companies/${companyBId}`)).send({ status: "suspended" }).expect(403);
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

  it("lets a lead executive add a lead and assign it to a field agent of their district", async () => {
    const FAR = { name: "Far Agent", phone: "9876500004", password: "Far-Pass-123", state: "Uttarakhand", district: "Dehradun" };
    const execId = String(ok(await asAdmin(http().post("/api/lead-collection/admin/users")).send(EXEC)).body.data._id);
    const farId = String(ok(await asAdmin(http().post("/api/lead-collection/admin/users")).send(FAR)).body.data._id);
    const execToken = await signIn(EXEC);
    const farToken = await signIn(FAR);
    const asExec = (req: request.Test) => req.set("Authorization", `Bearer ${execToken}`);
    const asFar = (req: request.Test) => req.set("Authorization", `Bearer ${farToken}`);
    const ids = (res: request.Response) => res.body.data.items.map((l: any) => String(l._id));

    // The executive chooses from the field agents of their own district.
    const agents = ok(await asExec(http().get("/api/lead-collection/agent/leads/field-agents")));
    expect(agents.body.data.map((a: any) => String(a._id))).toEqual([agentId]);

    // The assignee's name is read from their account, never taken from the request.
    const created = ok(
      await asExec(http().post("/api/lead-collection/agent/leads")).send({
        name: "Assigned Homestay",
        contact: { ownerName: "Test Host", phone: "9876500005" },
        assignedAgentId: agentId,
        assignedAgentName: "Someone Else",
      }),
    );
    const leadId = String(created.body.data._id);
    assignedLeadId = leadId;
    expect(String(created.body.data.assignedAgentId)).toBe(agentId);
    expect(created.body.data).toMatchObject({
      assignedAgentName: AGENT.name,
      capturedByName: EXEC.name,
      status: "pending",
      location: { state: AGENT.state, district: AGENT.district },
    });
    expect(ids(ok(await asExec(http().get("/api/lead-collection/agent/leads"))))).toContain(leadId);

    // The field agent sees the lead assigned to them.
    expect(ids(ok(await asAgent(http().get("/api/lead-collection/agent/leads"))))).toContain(leadId);
    ok(await asAgent(http().get(`/api/lead-collection/agent/leads/${leadId}`)));

    // Refused: another district, a field agent assigning or deleting, a bad id, a non-agent assignee.
    const assignUrl = `/api/lead-collection/agent/leads/${leadId}/assign`;
    await asExec(http().post(assignUrl)).send({ agentId: farId }).expect(403);
    await asAgent(http().post(assignUrl)).send({ agentId: null }).expect(403);
    await asAgent(http().put(`/api/lead-collection/agent/leads/${leadId}`)).send({ assignedAgentId: farId }).expect(403);
    await asAgent(http().post("/api/lead-collection/agent/leads")).send({ name: "Self Assigned", assignedAgentId: farId }).expect(403);
    await asAgent(http().delete(`/api/lead-collection/agent/leads/${leadId}`)).expect(403);
    await asExec(http().post(assignUrl)).send({ agentId: "not-an-id" }).expect(400);
    await asExec(http().post(assignUrl)).send({}).expect(400);
    await asAdmin(http().post(`/api/lead-collection/admin/leads/${leadId}/assign`)).send({ agentId: execId }).expect(400);

    // A full-object save that sends the same assignee back is still fine for the field agent.
    ok(await asAgent(http().put(`/api/lead-collection/agent/leads/${leadId}`)).send({ assignedAgentId: agentId, agentNotes: "Visited" }));

    // The Super Admin may assign across districts; that agent then sees the lead.
    const moved = ok(await asAdmin(http().post(`/api/lead-collection/admin/leads/${leadId}/assign`)).send({ agentId: farId }));
    expect(moved.body.data).toMatchObject({ assignedAgentName: FAR.name, lastUpdatedByRole: "super_admin" });
    expect(ids(ok(await asFar(http().get("/api/lead-collection/agent/leads"))))).toEqual([leadId]);
    ok(await asFar(http().get(`/api/lead-collection/agent/leads/${leadId}`)));
    expect(ok(await asFar(http().get("/api/lead-collection/agent/leads/stats"))).body.data.total).toBe(1);

    // The executive can unassign it and assign it back.
    const cleared = ok(await asExec(http().post(assignUrl)).send({ agentId: null }));
    expect(cleared.body.data).toMatchObject({ assignedAgentId: null, assignedAgentName: "" });
    const back = ok(await asExec(http().post(assignUrl)).send({ agentId }));
    expect(back.body.data).toMatchObject({ assignedAgentName: AGENT.name, lastUpdatedByName: EXEC.name });
  });

  it("never shows or changes one company's staff, leads or tracking to another company", async () => {
    const leadA = assignedLeadId;
    const admin = "/api/lead-collection/admin";

    // Company B's Super Admin starts with nothing of company A's.
    expect(ok(await asAdminB(http().get(`${admin}/users`))).body.data.total).toBe(0);
    expect(ok(await asAdminB(http().get(`${admin}/leads`))).body.data.total).toBe(0);
    expect(ok(await asAdminB(http().get(`${admin}/leads/stats`))).body.data.total).toBe(0);
    expect(ok(await asAdminB(http().get(`${admin}/attendance/summary`))).body.data).toEqual({ summaryMap: {}, todayMap: {} });
    expect(ok(await asAdminB(http().get(`${admin}/tracking/live`))).body.data).toEqual([]);

    // Company A's records, asked for by id, do not exist for company B (404, not 403).
    // Built one at a time: supertest requests share one server that closes after each request.
    const attempts: Array<[string, () => request.Test]> = [
      ["read agent", () => asAdminB(http().get(`${admin}/users/${agentId}`))],
      ["edit agent", () => asAdminB(http().put(`${admin}/users/${agentId}`)).send({ name: "Taken Over" })],
      ["reset agent password", () => asAdminB(http().post(`${admin}/users/${agentId}/reset-password`)).send({})],
      ["delete agent", () => asAdminB(http().delete(`${admin}/users/${agentId}`))],
      ["read lead", () => asAdminB(http().get(`${admin}/leads/${leadA}`))],
      ["edit lead", () => asAdminB(http().put(`${admin}/leads/${leadA}`)).send({ notes: "changed" })],
      ["assign lead", () => asAdminB(http().post(`${admin}/leads/${leadA}/assign`)).send({ agentId: null })],
      ["approve lead", () => asAdminB(http().post(`${admin}/leads/${leadA}/approve`)).send({})],
      ["delete lead", () => asAdminB(http().delete(`${admin}/leads/${leadA}`))],
      ["read attendance", () => asAdminB(http().get(`${admin}/attendance/agent/${agentId}`))],
      ["read tracking", () => asAdminB(http().get(`${admin}/agents/${agentId}/tracking`))],
      ["read tracking history", () => asAdminB(http().get(`${admin}/agents/${agentId}/tracking/history`))],
    ];
    for (const [what, attempt] of attempts) {
      const res = await attempt();
      if (res.status !== 404) throw new Error(`${what}: expected 404, got ${res.status} ${JSON.stringify(res.body)}`);
    }
    // ... and nothing was changed by those attempts.
    expect(ok(await asAdmin(http().get(`${admin}/users/${agentId}`))).body.data.name).toBe(AGENT.name);
    expect(ok(await asAdmin(http().get(`${admin}/leads/${leadA}`))).body.data).toMatchObject({
      status: "pending",
      assignedAgentName: AGENT.name,
    });
    ok(await http().post("/api/lead-collection/auth/login").send({ phone: AGENT.phone, password: AGENT.password }));

    // Each company keeps its own region list: both may add the same district.
    const jaipur = { state: "Rajasthan", district: "Jaipur" };
    ok(await asAdmin(http().post(`${admin}/regions`)).send(jaipur));
    const regionsB = ok(await asAdminB(http().get(`${admin}/regions`))).body.data;
    expect(regionsB.some((r: any) => r.district === "Jaipur")).toBe(false);
    ok(await asAdminB(http().post(`${admin}/regions`)).send(jaipur));
    await asAdmin(http().post(`${admin}/regions`)).send(jaipur).expect(409);

    // A mobile number is one sign-in across every company.
    await asAdminB(http().post(`${admin}/users`)).send({ ...AGENT, name: "Copy Of Agent" }).expect(409);

    // Company B's own field agent, in the same district as company A's.
    const B_AGENT = { name: "Beta Agent", phone: "9876500011", password: "Beta-Pass-12", state: AGENT.state, district: AGENT.district };
    const bAgentId = String(ok(await asAdminB(http().post(`${admin}/users`)).send(B_AGENT)).body.data._id);
    const bAgentToken = await signIn(B_AGENT);
    const asBAgent = bearer(bAgentToken);
    const asExec = bearer(await signIn(EXEC));

    // A's lead executive picks only from A's agents of the district, and cannot assign B's agent.
    const seen = ok(await asExec(http().get("/api/lead-collection/agent/leads/field-agents"))).body.data.map((a: any) => String(a._id));
    expect(seen).toContain(agentId);
    expect(seen).not.toContain(bAgentId);
    await asExec(http().post(`/api/lead-collection/agent/leads/${leadA}/assign`)).send({ agentId: bAgentId }).expect(400);
    await asAdmin(http().post(`${admin}/leads/${leadA}/assign`)).send({ agentId: bAgentId }).expect(400);
    await asAdminB(http().post(`${admin}/leads`)).send({ name: "Cross Assign", assignedAgentId: agentId }).expect(400);

    // B's agent, though in the same district, sees none of A's leads.
    expect(ok(await asBAgent(http().get("/api/lead-collection/agent/leads"))).body.data.total).toBe(0);
    await asBAgent(http().get(`/api/lead-collection/agent/leads/${leadA}`)).expect(404);

    // B's agent's attendance and GPS show on B's boards only.
    ok(await asBAgent(http().post("/api/lead-collection/agent/tracking/consent")).send({ granted: true }));
    ok(await asBAgent(http().post("/api/lead-collection/agent/attendance/check-in")).send({ coords: POINT }));
    ok(
      await asBAgent(http().post("/api/lead-collection/agent/tracking/fixes")).send({
        fixes: [{ ...POINT, recordedAt: new Date().toISOString(), source: "foreground" }],
      }),
    );
    expect(JSON.stringify(ok(await asAdminB(http().get(`${admin}/tracking/live`))).body.data)).toContain(bAgentId);
    const liveA = JSON.stringify(ok(await asAdmin(http().get(`${admin}/tracking/live`))).body.data);
    expect(liveA).toContain(agentId);
    expect(liveA).not.toContain(bAgentId);
    expect(Object.keys(ok(await asAdminB(http().get(`${admin}/attendance/summary`))).body.data.todayMap)).toEqual([bAgentId]);
    expect(Object.keys(ok(await asAdmin(http().get(`${admin}/attendance/summary`))).body.data.todayMap)).not.toContain(bAgentId);
    await asAdmin(http().get(`${admin}/agents/${bAgentId}/tracking`)).expect(404);

    // The platform owner sees each company's totals, never their records.
    const companies = ok(await asOwner(http().get("/api/platform/companies"))).body.data;
    expect(companies.find((c: any) => c.id === companyAId).counts).toEqual({ superAdmins: 1, staff: 3, activeStaff: 3, leads: 2 });
    expect(companies.find((c: any) => c.id === companyBId).counts).toEqual({ superAdmins: 1, staff: 1, activeStaff: 1, leads: 0 });
  });

  it("suspending a company signs out its Super Admins and staff and blocks their sign-in", async () => {
    const bAgent = { phone: "9876500011", password: "Beta-Pass-12" };
    const bAgentToken = await signIn(bAgent);

    const suspended = ok(await asOwner(http().put(`/api/platform/companies/${companyBId}`)).send({ status: "suspended" }));
    expect(suspended.body.data.status).toBe("suspended");

    await asAdminB(http().get("/api/auth/me")).expect(401);
    await bearer(bAgentToken)(http().get("/api/lead-collection/agent/leads")).expect(401);
    const adminLogin = await http().post("/api/auth/login").send({ email: ADMIN_B.email, password: adminBPassword });
    expect(adminLogin.status).toBe(401);
    expect(adminLogin.body.message).toMatch(/company's account is suspended/);
    const agentLogin = await http().post("/api/lead-collection/auth/login").send(bAgent);
    expect(agentLogin.status).toBe(401);
    expect(agentLogin.body.message).toMatch(/company's account is suspended/);

    // Company A carries on untouched.
    ok(await asAdmin(http().get("/api/auth/me")));
    ok(await asAgent(http().get("/api/lead-collection/agent/leads")));

    ok(await asOwner(http().put(`/api/platform/companies/${companyBId}`)).send({ status: "active" }));
    adminBToken = ok(await http().post("/api/auth/login").send({ email: ADMIN_B.email, password: adminBPassword })).body
      .data.token;
    await signIn(bAgent);
  });

  it("lets the platform owner add, suspend and reset a company's Super Admins", async () => {
    const added = ok(
      await asOwner(http().post(`/api/platform/companies/${companyBId}/admins`)).send({
        name: "Second Beta Admin",
        email: "beta-two@example.test",
      }),
    );
    const secondId = added.body.data.admin.id;
    const secondPassword = added.body.data.temporaryPassword;
    const second = ok(await http().post("/api/auth/login").send({ email: "beta-two@example.test", password: secondPassword }));
    expect(second.body.data.admin).toMatchObject({ role: "super_admin", companyId: companyBId });
    // The second admin works in the same company as the first.
    expect(ok(await bearer(second.body.data.token)(http().get("/api/lead-collection/admin/users"))).body.data.total).toBe(1);

    const detail = ok(await asOwner(http().get(`/api/platform/companies/${companyBId}`))).body.data;
    expect(detail.admins.map((a: any) => a.email).sort()).toEqual(["beta-admin@example.test", "beta-two@example.test"]);

    ok(await asOwner(http().put(`/api/platform/admins/${secondId}`)).send({ status: "suspended" }));
    await bearer(second.body.data.token)(http().get("/api/auth/me")).expect(401);
    await http().post("/api/auth/login").send({ email: "beta-two@example.test", password: secondPassword }).expect(401);

    const reset = ok(await asOwner(http().post(`/api/platform/admins/${detail.admins[0].id}/reset-password`)).send({}));
    await asAdminB(http().get("/api/auth/me")).expect(401);
    await http().post("/api/auth/login").send({ email: ADMIN_B.email, password: adminBPassword }).expect(401);
    ok(await http().post("/api/auth/login").send({ email: ADMIN_B.email, password: reset.body.data.temporaryPassword }));

    // The platform owner's own account is not reachable through these routes.
    await asOwner(http().put(`/api/platform/admins/${ownerId}`)).send({ status: "suspended" }).expect(404);
    await asOwner(http().post(`/api/platform/admins/${ownerId}/reset-password`)).send({}).expect(404);
    ok(await asOwner(http().get("/api/auth/me")));
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
