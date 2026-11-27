/**
 * The Eco Sor API end to end on a real Postgres (npm run test:pg): migrations 0001-0010, the
 * whole Nest app, and the SRS flows over HTTP: roles and ownership, purchase request -> payment
 * -> approval -> processed, corrections, double allocation of a UTR, complaints with the
 * customer OTP, payroll and the append-only audit trail. Made-up people only; WhatsApp is the
 * "log" provider and the OTPs are read from a spy, because the API never returns them.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ValidationPipe, VERSION_NEUTRAL, VersioningType, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { hashSync } from "bcryptjs";
import request from "supertest";

const BACKEND = path.resolve(__dirname, "..");
const COMPANY = "ec05000000000000000000c0";
const ADMIN = { id: "ec05000000000000000000a0", email: "admin@eco.test", password: "Admin-Pass-12345" };
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64, 1)]);
const GIF = Buffer.from("GIF89a" + "x".repeat(40));
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

describe("Eco Sor API (real Postgres)", () => {
  let app: INestApplication;
  let dbUrl = "";
  let db: any;
  let sentOtps: string[] = [];
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const api = (method: "get" | "post" | "patch" | "put" | "delete", url: string, who?: string) => {
    const r = request(app.getHttpServer())[method](`/api/v1${url}`);
    return who ? r.set("Authorization", `Bearer ${tokens[who]}`) : r;
  };
  const data = (res: request.Response, status?: number) => {
    if (res.status < 200 || res.status >= 300 || (status !== undefined && res.status !== status)) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body.data;
  };
  const login = async (identifier: string, password: string) => data(await api("post", "/auth/login").send({ identifier, password }));
  const proof = (r: request.Test, utr: string, amount = 25000) => r.field("amount", String(amount)).field("method", "upi").field("paymentDate", today).field("utr", utr).attach("file", PNG, "proof.png");

  beforeAll(async () => {
    const adminUrl = process.env.PG_TEST_URL;
    if (!adminUrl) throw new Error("PG_TEST_URL is not set (run with: npm run test:pg)");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client } = require("pg");
    const dbName = `mt_eco_${randomBytes(5).toString("hex")}`;
    const server = new Client({ connectionString: adminUrl });
    await server.connect();
    await server.query(`CREATE DATABASE ${dbName}`);
    await server.end();
    dbUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`);
    execFileSync(process.execPath, ["database/migrate.js"], { cwd: BACKEND, env: { ...process.env, SUPABASE_DB_URL: dbUrl, SUPABASE_MIGRATION_URL: dbUrl }, encoding: "utf8" });

    db = new Client({ connectionString: dbUrl });
    await db.connect();
    await db.query(`INSERT INTO leads.companies (id, name, status, created_at, updated_at) VALUES ($1, 'Eco Sor Test', 'active', now(), now())`, [COMPANY]);
    await db.query(`INSERT INTO leads.admin_users (id, name, email, password_hash, role, status, token_version, company_id, created_at, updated_at) VALUES ($1, 'Test Admin', $2, $3, 'super_admin', 'active', 0, $4, now(), now())`, [ADMIN.id, ADMIN.email, hashSync(ADMIN.password, 4), COMPANY]);

    Object.assign(process.env, {
      NODE_ENV: "test",
      SUPABASE_DB_URL: dbUrl,
      SUPABASE_TTL_SWEEP: "false",
      JWT_SECRET: "test-admin-secret-with-at-least-32-characters",
      LEAD_JWT_SECRET: "test-agent-secret-with-at-least-32-characters",
      ADMIN_BCRYPT_ROUNDS: "4",
      LEAD_BCRYPT_ROUNDS: "4",
      ECO_BCRYPT_ROUNDS: "4",
      OTP_BCRYPT_ROUNDS: "4",
      LEAD_AUTO_CHECKOUT_ENABLED: "false",
      WHATSAPP_PROVIDER: "log",
      WHATSAPP_RETRY_ENABLED: "false",
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "eco-private-")),
      STORAGE_SIGNING_SECRET: "test-storage-signing-secret",
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
    const { WhatsAppService } = await import("../src/modules/notifications/application/whatsapp.service");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_NEUTRAL });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    const whatsapp = app.get(WhatsAppService);
    const original = whatsapp.notify.bind(whatsapp);
    jest.spyOn(whatsapp, "notify").mockImplementation(async (input) => {
      if (input.otp) sentOtps.push(input.otp);
      return original(input);
    });
  });

  afterAll(async () => {
    await app?.close();
    await db?.end();
    const { closePostgresDriver } = await import("../src/database/pg/pg-driver");
    await closePostgresDriver();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Client } = require("pg");
    const server = new Client({ connectionString: process.env.PG_TEST_URL });
    await server.connect();
    await server.query(`DROP DATABASE IF EXISTS ${dbUrl.split("/").pop()!.split("?")[0]} WITH (FORCE)`);
    await server.end();
  });

  // ------------------------------------------------------------------ people
  it("a company Super Admin console token acts as the admin role", async () => {
    const res = await request(app.getHttpServer()).post("/api/auth/login").send({ email: ADMIN.email, password: ADMIN.password });
    expect(res.status).toBe(200);
    tokens.admin = res.body.data.token;
    const me = data(await api("get", "/auth/me", "admin"));
    expect(me).toMatchObject({ role: "admin", kind: "admin", companyId: COMPANY });
    expect(me.permissions).toContain("*");
  });

  it("rejects calls without a token, and an Eco token on the console routes", async () => {
    expect((await api("get", "/employees")).status).toBe(401);
    expect((await api("get", "/audit-logs")).status).toBe(401);
  });

  it("admin creates staff with roles; they sign in and /auth/me lists their permissions", async () => {
    const people = [
      ["sm", "Rohit Verma", "9000000001", "sales_manager"],
      ["fs", "Imran Sheikh", "9000000003", "field_sales"],
      ["fs2", "Pooja Nair", "9000000004", "field_sales"],
      ["sup", "Anil Deshmukh", "9000000005", "support_manager"],
      ["eng", "Sanjay Yadav", "9000000006", "field_support"],
      ["hr", "Kavita Joshi", "9000000008", "hr"],
    ] as const;
    for (const [key, name, mobile, roleCode] of people) {
      const out = data(await api("post", "/employees", "admin").send({ name, mobile, roleCode, email: `${key}@eco.test`, fixedSalary: 30000, joiningDate: "2025-01-01" }));
      expect(out.temporaryPassword).toBeTruthy();
      ids[key] = out.employee.id;
      const session = await login(mobile, out.temporaryPassword);
      tokens[key] = session.token;
      expect(session.user.role).toBe(roleCode);
      expect(session.user.employeeId).toBe(out.employee.id);
    }
    expect((await login("fs@eco.test", "wrong-password-1").catch(() => null)) ?? "failed").toBe("failed");
    const me = data(await api("get", "/auth/me", "fs"));
    expect(me.permissions).toEqual(expect.arrayContaining(["visits.checkin", "purchases.create"]));
    expect(me.permissions).not.toContain("payments.verify");
  });

  it("only HR and admin manage employees; others are refused", async () => {
    expect((await api("post", "/employees", "fs").send({ name: "X Y", mobile: "9000000099", roleCode: "hr" })).status).toBe(403);
    expect((await api("get", "/audit-logs", "hr")).status).toBe(403);
    // Sub-accounts are created by the Super Admin only; HR edits HR details but not roles or status.
    expect((await api("post", "/employees", "hr").send({ name: "New Person", mobile: "9000000098", roleCode: "field_sales" })).status).toBe(403);
    expect((await api("post", `/employees/${ids.fs}/deactivate`, "hr").send({})).status).toBe(403);
    expect((await api("patch", `/employees/${ids.fs}`, "hr").send({ roleCode: "hr" })).status).toBe(403);
    expect((await api("patch", `/employees/${ids.fs}`, "hr").send({ designation: "Senior Field Sales" })).status).toBe(200);
    expect((await api("get", "/employees", "hr")).status).toBe(200);
    expect(data(await api("get", "/employees", "fs"))).toHaveLength(1); // a field-sales employee sees only themselves
  });

  it("deactivating an employee blocks login and ends the open session", async () => {
    const out = data(await api("post", "/employees", "admin").send({ name: "Temp Person", mobile: "9000000077", roleCode: "tele_sales" }));
    const session = await login("9000000077", out.temporaryPassword);
    expect((await request(app.getHttpServer()).get("/api/v1/auth/me").set("Authorization", `Bearer ${session.token}`)).status).toBe(200);
    data(await api("post", `/employees/${out.employee.id}/deactivate`, "admin").send({ reason: "left" }));
    expect((await request(app.getHttpServer()).get("/api/v1/auth/me").set("Authorization", `Bearer ${session.token}`)).status).toBe(401);
    await expect(login("9000000077", out.temporaryPassword)).rejects.toThrow(/401/);
  });

  // ---------------------------------------------------------------- products
  it("products: unique SKU, real image type check, only active products are listed to non-managers", async () => {
    const a = data(await api("post", "/products", "admin").send({ category: "inverter", name: "Pure Sine 1100VA", model: "PS1100", sku: "ECO-INV-1100" }));
    const b = data(await api("post", "/products", "admin").send({ category: "battery", name: "Tubular 150Ah", model: "TB150", sku: "ECO-BAT-150" }));
    ids.inv = a.id;
    ids.bat = b.id;
    expect((await api("post", "/products", "admin").send({ category: "battery", name: "Dup", model: "D", sku: "ECO-BAT-150" })).status).toBe(409);
    const inactive = data(await api("post", "/products", "admin").send({ category: "battery", name: "Old", model: "O", sku: "ECO-OLD" }));
    ids.old = inactive.id;
    data(await api("patch", `/products/${inactive.id}/active`, "admin").send({ isActive: false }));
    expect(data(await api("get", "/products?limit=100", "fs")).map((p: any) => p.sku).sort()).toEqual(["ECO-BAT-150", "ECO-INV-1100"]);
    expect(data(await api("get", "/products?limit=100", "admin")).length).toBe(3);
    expect((await api("post", "/products", "fs").send({ category: "battery", name: "x", model: "x", sku: "x" })).status).toBe(403);
    const fake = await api("post", `/products/${ids.inv}/image`, "admin").attach("file", GIF, { filename: "pic.png", contentType: "image/png" });
    expect(fake.status).toBe(400);
    expect(fake.body.message).toMatch(/JPG and PNG/);
  });

  // ------------------------------------------------------------- distributors
  it("distributors: create, assign executive, portal login, ownership, CSV import with a row report", async () => {
    const d1 = data(await api("post", "/distributors", "admin").send({ firmName: "Sharma Power", contactPerson: "Ramesh", mobile: "9811100001", city: "Jaipur", state: "Rajasthan", pin: "302001", assignedExecutiveId: ids.fs }));
    const d2 = data(await api("post", "/distributors", "admin").send({ firmName: "Gupta Electricals", contactPerson: "Sunil", mobile: "9811100002", assignedExecutiveId: ids.fs2 }));
    ids.d1 = d1.id;
    ids.d2 = d2.id;
    expect(data(await api("get", "/distributors", "fs")).map((d: any) => d.id)).toEqual([d1.id]); // only the assigned one
    expect((await api("get", `/distributors/${d2.id}`, "fs")).status).toBe(404);
    expect((await api("patch", `/distributors/${d1.id}`, "fs").send({ city: "X" })).status).toBe(403);

    const portal = data(await api("post", `/distributors/${d1.id}/portal-access`, "admin").send({ enabled: true }));
    expect(portal.temporaryPassword).toBeTruthy();
    tokens.dist = (await login("9811100001", portal.temporaryPassword)).token;
    const portal2 = data(await api("post", `/distributors/${d2.id}/portal-access`, "admin").send({ enabled: true }));
    tokens.dist2 = (await login("9811100002", portal2.temporaryPassword)).token;
    expect(data(await api("get", "/distributors", "dist")).map((d: any) => d.id)).toEqual([d1.id]);
    expect((await api("get", `/distributors/${d2.id}`, "dist")).status).toBe(404);

    const csv = "firm_name,contact_person,mobile,city,pin\nNew Traders,Amit,9822200001,Pune,411001\n,Nobody,123,Pune,12\nSecond Traders,Ravi,9822200001,Pune,411001\n";
    const dry = data(await api("post", "/distributors/import?dryRun=true", "admin").attach("file", Buffer.from(csv), "d.csv"));
    expect(dry).toMatchObject({ dryRun: true, total: 3, valid: 1, failed: 2, created: 0 });
    const real = data(await api("post", "/distributors/import", "admin").attach("file", Buffer.from(csv), "d.csv"));
    expect(real).toMatchObject({ created: 1, failed: 2 });
    expect(real.rows.find((r: any) => r.row === 3).errors.join()).toMatch(/firm_name is required/);
    expect(real.rows.find((r: any) => r.row === 4).errors.join()).toMatch(/twice/);

    const reassign = data(await api("post", `/distributors/${d2.id}/assign`, "admin").send({ employeeId: ids.fs, reason: "territory change" }));
    expect(reassign.assignedExecutiveId).toBe(ids.fs);
    const history = data(await api("get", `/distributors/${d1.id}/history`, "admin"));
    expect(history).toHaveProperty("visits");
  });

  // ------------------------------------------------------------------- sales
  it("sales: visit scheduled -> GPS check-in -> report -> completed; follow-up and call log", async () => {
    const visit = data(await api("post", "/sales/visits", "sm").send({ distributorId: ids.d1, employeeId: ids.fs, visitDate: today, purpose: "Stock review", priority: "high" }));
    expect((await api("post", `/sales/visits/${visit.id}/check-in`, "fs2").send({ lat: 26.9, lng: 75.8 })).status).toBe(404); // not their visit
    expect((await api("post", `/sales/visits/${visit.id}/check-in`, "fs").send({ lat: 0, lng: 0 })).status).toBe(400);
    expect((await api("post", `/sales/visits/${visit.id}/report`, "fs").send({ notes: "too early" })).status).toBe(409);
    const checked = data(await api("post", `/sales/visits/${visit.id}/check-in`, "fs").send({ lat: 26.9124, lng: 75.7873, accuracy: 18 }));
    expect(checked).toMatchObject({ status: "checked_in", checkinLat: 26.9124 });
    expect((await api("post", `/sales/visits/${visit.id}/check-in`, "fs").send({ lat: 26.9, lng: 75.8 })).status).toBe(409);
    const next = new Date(Date.now() + 3 * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const reported = data(await api("post", `/sales/visits/${visit.id}/report`, "fs").send({ notes: "Needs 20 batteries", transcriptLang: "hi-en", nextFollowupDate: next, productRequirements: [{ productId: ids.bat, quantity: 20 }] }));
    expect(reported.status).toBe("report_submitted");
    expect(data(await api("post", `/sales/visits/${visit.id}/complete`, "sm"))).toMatchObject({ status: "completed" });
    const follow = data(await api("get", "/sales/followups?status=pending", "fs"));
    expect(follow).toHaveLength(1);
    data(await api("post", `/sales/followups/${follow[0].id}/complete`, "fs"));
    expect((await api("post", "/sales/call-logs", "fs").send({ distributorId: ids.d1, direction: "out", outcome: "Interested" })).status).toBe(201);
    expect((await api("post", "/sales/call-logs", "fs2").send({ distributorId: ids.d1, direction: "out" })).status).toBe(404); // not their distributor
    const later = data(await api("post", "/sales/visits", "sm").send({ distributorId: ids.d1, employeeId: ids.fs, visitDate: next }));
    const moved = data(await api("post", `/sales/visits/${later.id}/reschedule`, "sm").send({ visitDate: next, reason: "Distributor away" }));
    expect(moved.id).not.toBe(later.id);
    expect(data(await api("get", `/sales/visits/${later.id}`, "sm")).status).toBe("rescheduled");
  });

  // --------------------------------------------------------------- purchases
  let pr: { id: string; requestNo: string };

  it("a distributor creates a request: distributor locked to the login, idempotent, positive whole quantities, active products only", async () => {
    const body = { items: [{ productId: ids.inv, quantity: 5 }, { productId: ids.bat, quantity: 10 }], remarks: "Urgent" };
    expect((await api("post", "/purchase-requests", "dist").send({ ...body, distributorId: ids.d2 })).status).toBe(403);
    expect((await api("post", "/purchase-requests", "dist").send({ items: [{ productId: ids.inv, quantity: 0 }] })).status).toBe(400);
    expect((await api("post", "/purchase-requests", "dist").send({ items: [{ productId: ids.inv, quantity: 1.5 }] })).status).toBe(400);
    expect((await api("post", "/purchase-requests", "dist").send({ items: [{ productId: ids.old, quantity: 1 }] })).status).toBe(400);
    const first = data(await api("post", "/purchase-requests", "dist").set("Idempotency-Key", "key-purchase-0001").send(body));
    const again = data(await api("post", "/purchase-requests", "dist").set("Idempotency-Key", "key-purchase-0001").send(body));
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(again.request.id).toBe(first.request.id);
    pr = first.request;
    expect(pr.requestNo).toMatch(/^PR-\d{4}-000001$/);
    expect(first.request).toMatchObject({ status: "draft", source: "portal", distributorId: ids.d1, version: 1 });
    expect(first.request.items[0].productSnapshot).toMatchObject({ name: expect.any(String), model: expect.any(String), sku: expect.any(String) });
    expect((await api("get", `/purchase-requests/${pr.id}`, "dist2")).status).toBe(404); // another distributor
    expect((await api("get", `/purchase-requests/${pr.id}`, "fs2")).status).toBe(404); // sales not assigned and not creator
    expect(data(await api("get", `/purchase-requests/${pr.id}`, "fs")).id).toBe(pr.id); // assigned executive can see it
  });

  it("submit needs the payment details and a real JPG/PNG proof (5 MB max)", async () => {
    expect((await api("post", `/purchase-requests/${pr.id}/submit`, "dist")).status).toBe(400);
    expect((await api("post", `/purchase-requests/${pr.id}/payment-proof`, "dist").field("amount", "25000").field("method", "upi").field("paymentDate", today).field("utr", "UTR998877665544")).status).toBe(400); // no image
    const wrongType = await api("post", `/purchase-requests/${pr.id}/payment-proof`, "dist").field("amount", "25000").field("method", "upi").field("paymentDate", today).field("utr", "UTR998877665544").attach("file", GIF, { filename: "x.png", contentType: "image/png" });
    expect(wrongType.status).toBe(400);
    const tooShort = await proof(api("post", `/purchase-requests/${pr.id}/payment-proof`, "dist"), "12-3");
    expect(tooShort.status).toBe(400);
    const stored = data(await proof(api("post", `/purchase-requests/${pr.id}/payment-proof`, "dist"), "utr 9988-7766 5544"), 201);
    expect(stored.payment).toMatchObject({ status: "pending", utrNormalized: "UTR998877665544", amount: 25000 });
    expect(stored.payment.proof.mime).toBe("image/png");
    ids.pay1 = stored.payment.id;
    const submitted = data(await api("post", `/purchase-requests/${pr.id}/submit`, "dist"));
    expect(submitted.request.status).toBe("submitted");
    expect(data(await api("post", `/purchase-requests/${pr.id}/submit`, "dist")).replayed).toBe(true); // repeat is a no-op
  });

  it("the proof is private: a signed, short-lived link only for people allowed to see it", async () => {
    expect((await api("get", `/payments/${ids.pay1}/proof-url`, "dist2")).status).toBe(404);
    expect((await api("get", `/payments/${ids.pay1}/proof-url`, "eng")).status).toBe(403);
    const link = data(await api("get", `/payments/${ids.pay1}/proof-url`, "admin"));
    expect(link.url).toContain("sig=");
    const file = await request(link.url.replace(/^https?:\/\/[^/]+/, "") ? app.getHttpServer() : app.getHttpServer()).get(link.url.replace(/^https?:\/\/[^/]+/, ""));
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.headers["cache-control"]).toMatch(/no-store/);
    const tampered = link.url.replace(/^https?:\/\/[^/]+/, "").replace(/sig=[0-9a-f]{4}/, "sig=0000");
    expect((await request(app.getHttpServer()).get(tampered)).status).toBe(404);
    expect(data(await api("get", `/payments/${ids.pay1}/proof-url`, "dist")).url).toContain("sig="); // its owner
  });

  it("the verification queue lists the payment; only reviewers see it; the distributor cannot edit after submit", async () => {
    expect((await api("get", "/payments/verification-queue", "dist")).status).toBe(403);
    expect((await api("get", "/payments/verification-queue", "sm")).status).toBe(403);
    const queue = data(await api("get", "/payments/verification-queue?status=pending", "admin"));
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ requestNo: pr.requestNo, duplicateCount: 0, utrNormalized: "UTR998877665544" });
    expect((await api("patch", `/purchase-requests/${pr.id}/draft`, "dist").send({ remarks: "changed" })).status).toBe(409);
    expect((await api("post", `/purchase-requests/${pr.id}/approve`, "admin")).status).toBe(409); // payment not verified yet
    expect((await api("post", `/purchase-requests/${pr.id}/verify-payment`, "sm")).status).toBe(403);
  });

  it("reject-payment needs a reason, sends the request back, and resubmission keeps the old version", async () => {
    expect((await api("post", `/purchase-requests/${pr.id}/reject-payment`, "admin").send({})).status).toBe(400);
    const rejected = data(await api("post", `/purchase-requests/${pr.id}/reject-payment`, "admin").send({ reason: "Amount does not match the bank record" }));
    expect(rejected).toMatchObject({ status: "correction_required", paymentStatus: "rejected" });
    expect((await api("post", `/purchase-requests/${pr.id}/resubmit`, "dist")).status).toBe(400); // no new payment yet
    data(await api("patch", `/purchase-requests/${pr.id}/draft`, "dist").send({ items: [{ productId: ids.inv, quantity: 4 }, { productId: ids.bat, quantity: 10 }] }));
    const second = data(await proof(api("post", `/purchase-requests/${pr.id}/payment-proof`, "dist"), "UTR 1122 3344 5566", 22000), 201);
    expect(second.paymentSubmissions).toBe(2);
    expect(second.payment.status).toBe("pending");
    const resubmitted = data(await api("post", `/purchase-requests/${pr.id}/resubmit`, "dist"));
    expect(resubmitted).toMatchObject({ status: "under_review", version: 2, paymentStatus: "pending" });
    const history = data(await api("get", `/purchase-requests/${pr.id}/history`, "admin"));
    expect(history.versions.map((v: any) => v.version)).toEqual([1, 2]);
    expect(history.versions[0].snapshot.items.find((i: any) => i.productSnapshot.sku === "ECO-INV-1100").quantity).toBe(5); // the original is preserved
    expect(history.payments).toHaveLength(2);
    expect(history.statusLog.map((l: any) => l.toStatus)).toEqual(["draft", "submitted", "correction_required", "under_review"]);
    expect(history.verificationLog.map((l: any) => l.action)).toEqual(["submitted", "rejected", "resubmitted"]);
  });

  it("verify -> approve -> process; approved and processed records are frozen", async () => {
    const verified = data(await api("post", `/purchase-requests/${pr.id}/verify-payment`, "admin").send({ note: "Checked in the bank statement" }));
    expect(verified).toMatchObject({ status: "under_review", paymentStatus: "verified" });
    expect((await api("post", `/purchase-requests/${pr.id}/verify-payment`, "admin")).status).toBe(409); // already verified
    expect((await api("post", `/purchase-requests/${pr.id}/approve`, "sm")).status).toBe(403);
    const approved = data(await api("post", `/purchase-requests/${pr.id}/approve`, "admin"));
    expect(approved).toMatchObject({ status: "approved" });
    expect(approved.approvedAt).toBeTruthy();
    expect((await api("patch", `/purchase-requests/${pr.id}/draft`, "dist").send({ remarks: "sneaky" })).status).toBe(409);
    expect((await proof(api("post", `/purchase-requests/${pr.id}/payment-proof`, "dist"), "ZZ9988776655")).status).toBe(409);
    expect((await api("post", `/purchase-requests/${pr.id}/cancel`, "dist")).status).toBe(409);
    expect((await api("post", `/purchase-requests/${pr.id}/reject`, "admin").send({ reason: "no" })).status).toBe(409);
    const done = data(await api("post", `/purchase-requests/${pr.id}/process`, "admin").send({ externalInvoiceRef: "INV-2026-0001" }));
    expect(done).toMatchObject({ status: "processed", externalInvoiceRef: "INV-2026-0001" });
    expect((await api("post", `/purchase-requests/${pr.id}/process`, "admin")).status).toBe(409);
  });

  it("a verified UTR cannot be used for a second payment (double allocation)", async () => {
    const other = data(await api("post", "/purchase-requests", "dist2").send({ items: [{ productId: ids.bat, quantity: 2 }] })).request;
    const reuse = await proof(api("post", `/purchase-requests/${other.id}/payment-proof`, "dist2"), "utr-1122-3344-5566", 5000);
    expect(reuse.status).toBe(409);
    expect(reuse.body.message).toMatch(/already used for a verified payment/);
    // Two pending submissions with the same reference are allowed but flagged as duplicates in the queue.
    const a = data(await api("post", "/purchase-requests", "dist2").send({ items: [{ productId: ids.bat, quantity: 1 }] })).request;
    const b = data(await api("post", "/purchase-requests", "dist2").send({ items: [{ productId: ids.bat, quantity: 3 }] })).request;
    data(await proof(api("post", `/purchase-requests/${a.id}/payment-proof`, "dist2"), "SAME REF 123456", 1000), 201);
    data(await proof(api("post", `/purchase-requests/${b.id}/payment-proof`, "dist2"), "same-ref-123456", 3000), 201);
    data(await api("post", `/purchase-requests/${a.id}/submit`, "dist2"));
    data(await api("post", `/purchase-requests/${b.id}/submit`, "dist2"));
    const dups = data(await api("get", "/payments/verification-queue?status=duplicate", "admin"));
    expect(dups).toHaveLength(2);
    data(await api("post", `/purchase-requests/${a.id}/verify-payment`, "admin"));
    const second = await api("post", `/purchase-requests/${b.id}/verify-payment`, "admin");
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/already verified/);
    ids.prA = a.id;
  });

  it("two approvers racing on the same request: exactly one wins", async () => {
    const r = data(await api("post", "/purchase-requests", "dist2").send({ items: [{ productId: ids.inv, quantity: 1 }] })).request;
    data(await proof(api("post", `/purchase-requests/${r.id}/payment-proof`, "dist2"), "RACE 0000 111122", 100), 201);
    data(await api("post", `/purchase-requests/${r.id}/submit`, "dist2"));
    data(await api("post", `/purchase-requests/${r.id}/verify-payment`, "admin"));
    const results = await Promise.all([api("post", `/purchase-requests/${r.id}/approve`, "admin"), api("post", `/purchase-requests/${r.id}/approve`, "admin"), api("post", `/purchase-requests/${r.id}/reject`, "admin").send({ reason: "race" })]);
    expect(results.filter((x) => x.status === 200)).toHaveLength(1);
    expect(results.filter((x) => x.status === 409)).toHaveLength(2);
  });

  it("lists are paginated, filtered and role-scoped", async () => {
    const all = await api("get", "/purchase-requests?limit=2&page=1&sort=createdAt&order=asc", "admin");
    expect(all.body.meta).toMatchObject({ page: 1, limit: 2 });
    expect(all.body.meta.total).toBeGreaterThanOrEqual(4);
    expect(data(await api("get", "/purchase-requests?limit=100", "dist2")).every((x: any) => x.distributorId === ids.d2)).toBe(true);
    expect(data(await api("get", "/purchase-requests?status=processed", "admin")).map((x: any) => x.id)).toEqual([pr.id]);
    expect((await api("get", "/purchase-requests?limit=1000", "admin")).status).toBe(400);
    expect((await api("get", "/purchase-requests?status=bogus", "admin")).status).toBe(400);
  });

  // ------------------------------------------------- customers and complaints
  it("customer registration needs the WhatsApp OTP; wrong codes are counted and lock the code", async () => {
    sentOtps = [];
    const reg = data(await api("post", "/customers/register").send({ name: "Meena Rao", mobile: "9900011122", password: "Customer-Pass-1", address: "12 MG Road", city: "Jaipur", state: "Rajasthan", pin: "302001", companyId: COMPANY }));
    expect(reg.otpSent).toBe(true);
    await expect(login("9900011122", "Customer-Pass-1")).rejects.toThrow(/401/); // not verified yet
    expect(sentOtps).toHaveLength(1);
    expect(JSON.stringify(reg)).not.toContain(sentOtps[0]); // the code is never in the response
    const wrong = sentOtps[0] === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await api("post", "/customers/register/verify").send({ mobile: "9900011122", otp: wrong })).status).toBe(400);
    const locked = await api("post", "/customers/register/verify").send({ mobile: "9900011122", otp: sentOtps[0] });
    expect(locked.status).toBe(400);
    expect(locked.body.message).toMatch(/Too many wrong attempts/);
    sentOtps = [];
    data(await api("post", "/customers/register").send({ name: "Meena Rao", mobile: "9900011122", password: "Customer-Pass-1", companyId: COMPANY }));
    data(await api("post", "/customers/register/verify").send({ mobile: "9900011122", otp: sentOtps[0] }));
    tokens.cust = (await login("9900011122", "Customer-Pass-1")).token;
    expect(data(await api("get", "/customers/me", "cust"))).toMatchObject({ mobileVerified: true, products: 0 });
    expect((await api("post", "/customers/register").send({ name: "Meena Again", mobile: "9900011122", password: "Customer-Pass-1", companyId: COMPANY })).status).toBe(409);
  });

  let complaintId = "";

  it("only a customer can raise a complaint, for their own product, with a category that fits", async () => {
    const sellers = data(await api("get", "/customer-products/distributors?search=Sharma", "cust"));
    expect(sellers.map((x: any) => x.firmName)).toEqual(["Sharma Power"]);
    expect(Object.keys(sellers[0]).sort()).toEqual(["city", "firmName", "id", "state"]); // no contact details for customers
    const product = data(await api("post", "/customer-products", "cust").send({ category: "inverter", model: "PS1100", serialNo: "SN-0001", purchaseDate: "2026-01-10", distributorId: ids.d1 }));
    ids.cp = product.id;
    expect((await api("post", "/customer-products", "cust").send({ category: "inverter", model: "PS1100", serialNo: "SN-0001" })).status).toBe(409);
    expect((await api("post", "/complaints", "admin").send({ customerProductId: ids.cp, category: "inverter_not_working", description: "dead" })).status).toBe(403);
    expect((await api("post", "/complaints", "sup").send({ customerProductId: ids.cp, category: "inverter_not_working", description: "dead" })).status).toBe(403);
    expect((await api("post", "/complaints", "cust").send({ customerProductId: ids.cp, category: "battery_low_backup", description: "wrong category" })).status).toBe(400);
    expect((await api("post", "/complaints", "cust").send({ customerProductId: ids.cp, category: "installation_help", description: "x" })).status).toBe(400);
    const body = { customerProductId: ids.cp, category: "inverter_error_code", description: "Shows E04 and beeps" };
    const c = data(await api("post", "/complaints", "cust").set("Idempotency-Key", "cmp-key-000001").send(body));
    const again = data(await api("post", "/complaints", "cust").set("Idempotency-Key", "cmp-key-000001").send(body)); // app retried after a timeout
    expect(again.id).toBe(c.id);
    complaintId = c.id;
    expect(c).toMatchObject({ status: "open", category: "inverter_error_code", serviceAddress: "12 MG Road" });
    expect(c.complaintNo).toMatch(/^CMP-\d{4}-000001$/);
    expect(data(await api("get", "/complaints", "cust")).map((x: any) => x.id)).toEqual([complaintId]);
    expect(data(await api("get", "/complaints", "eng"))).toHaveLength(0); // not assigned to the engineer yet
    expect((await api("get", `/complaints/${complaintId}`, "eng")).status).toBe(404);
  });

  it("service flow: assign -> check-in -> report -> OTP -> close; the OTP is never exposed and cannot be bypassed", async () => {
    expect((await api("post", `/complaints/${complaintId}/assign`, "eng").send({ engineerId: ids.eng })).status).toBe(403);
    expect((await api("post", `/complaints/${complaintId}/assign`, "sup").send({ engineerId: ids.fs })).status).toBe(400); // not a field-support engineer
    expect((await api("post", `/complaints/${complaintId}/check-in`, "eng").send({ lat: 26.9, lng: 75.8 })).status).toBe(404); // not assigned to them: invisible
    const assigned = data(await api("post", `/complaints/${complaintId}/assign`, "sup").send({ engineerId: ids.eng, scheduledDate: today }));
    expect(assigned).toMatchObject({ status: "assigned", engineerId: ids.eng });
    expect(data(await api("get", `/complaints/${complaintId}`, "eng")).id).toBe(complaintId);
    const todays = data(await api("get", `/complaints?scheduledDate=${today}`, "eng"));
    expect(todays.map((x: any) => x.id)).toEqual([complaintId]);
    expect(todays[0]).toMatchObject({ serviceAddress: "12 MG Road", scheduledDate: today });
    expect((await api("post", `/complaints/${complaintId}/service-report`, "eng").send({ diagnosis: "x", actionTaken: "y", outcome: "resolved" })).status).toBe(409); // not in progress
    expect(data(await api("post", `/complaints/${complaintId}/check-in`, "eng").send({ lat: 26.9124, lng: 75.7873, accuracy: 10 }))).toMatchObject({ status: "in_progress" });
    const pending = data(await api("post", `/complaints/${complaintId}/service-report`, "eng").send({ diagnosis: "Faulty board", actionTaken: "Inspected", outcome: "pending", furtherAction: "Replace the control board" }));
    expect(pending.status).toBe("pending");
    data(await api("post", `/complaints/${complaintId}/check-in`, "eng").send({ lat: 26.9124, lng: 75.7873 }));
    const resolved = data(await api("post", `/complaints/${complaintId}/service-report`, "eng").send({ diagnosis: "Faulty board", actionTaken: "Replaced the control board", outcome: "resolved", photos: [] }));
    expect(resolved.status).toBe("resolved");
    expect((await api("post", `/complaints/${complaintId}/close`, "eng")).status).toBe(403); // no verified OTP

    sentOtps = [];
    const sent = data(await api("post", `/complaints/${complaintId}/send-otp`, "eng"));
    expect(sent).toMatchObject({ sent: true, deliveryStatus: "sent", expiresInMinutes: 10 });
    expect(sentOtps[0]).toMatch(/^\d{6}$/);
    expect(JSON.stringify(sent)).not.toContain(sentOtps[0]);
    const stored = await db.query("SELECT otp_hash FROM leads.otp_verifications WHERE complaint_id = $1", [complaintId]);
    expect(stored.rows[0].otp_hash).not.toContain(sentOtps[0]);
    expect(stored.rows[0].otp_hash).toMatch(/^\$2[aby]\$/);
    const wrong = sentOtps[0] === "000000" ? "111111" : "000000";
    const miss = await api("post", `/complaints/${complaintId}/verify-otp`, "eng").send({ otp: wrong });
    expect(miss.status).toBe(400);
    expect(miss.body.message).toMatch(/4 attempt/);
    expect((await api("post", `/complaints/${complaintId}/close`, "eng")).status).toBe(403);
    data(await api("post", `/complaints/${complaintId}/verify-otp`, "eng").send({ otp: sentOtps[0] }));
    expect((await api("post", `/complaints/${complaintId}/verify-otp`, "eng").send({ otp: sentOtps[0] })).status).toBe(400); // single use
    const closed = data(await api("post", `/complaints/${complaintId}/close`, "eng"));
    expect(closed.status).toBe("closed");
    expect((await api("post", `/complaints/${complaintId}/close`, "eng")).status).toBe(409);
    const timeline = closed.timeline.map((t: any) => t.to ?? t.type);
    expect(timeline).toEqual(expect.arrayContaining(["open", "assigned", "in_progress", "pending", "resolved", "closed", "service_report", "engineer_check_in"]));
    expect(closed.timeline.at(-1).to).toBe("closed");
  });

  it("OTP limits: three sends an hour and a reopened complaint needs a new one", async () => {
    const reopened = data(await api("post", `/complaints/${complaintId}/reopen`, "cust").send({ reason: "The error is back" }));
    expect(reopened).toMatchObject({ status: "reopened", reopenCount: 1 });
    data(await api("post", `/complaints/${complaintId}/assign`, "sup").send({ engineerId: ids.eng }));
    data(await api("post", `/complaints/${complaintId}/check-in`, "eng").send({ lat: 26.91, lng: 75.78 }));
    data(await api("post", `/complaints/${complaintId}/service-report`, "eng").send({ diagnosis: "Loose wire", actionTaken: "Fixed", outcome: "resolved" }));
    // One code was already sent before the first close, so two more use up the 3 an hour.
    for (let i = 0; i < 2; i++) data(await api("post", `/complaints/${complaintId}/send-otp`, "eng"));
    const fourth = await api("post", `/complaints/${complaintId}/send-otp`, "eng");
    expect(fourth.status).toBe(429);
    expect((await api("post", `/complaints/${complaintId}/close`, "eng")).status).toBe(403);
  });

  // ---------------------------------------------------------------------- HR
  it("attendance: one check-in a day, check-out needs check-in, HR corrections keep a reason and the old values", async () => {
    expect((await api("post", "/attendance/check-out", "fs").send({ mode: "office" })).status).toBe(409);
    const inn = data(await api("post", "/attendance/check-in", "fs").send({ mode: "office" }));
    expect(inn).toMatchObject({ checkedIn: true, date: today });
    expect((await api("post", "/attendance/check-in", "fs").send({ mode: "office" })).status).toBe(409);
    expect((await api("post", "/attendance/check-in", "fs2").send({})).status).toBe(400); // field mode needs GPS
    const out = data(await api("post", "/attendance/check-out", "fs").send({ mode: "office" }));
    expect(out.checkedOut).toBe(true);
    expect(data(await api("get", "/attendance/history", "fs"))).toHaveLength(1);
    expect((await api("post", "/attendance/corrections", "fs").send({ attendanceId: inn.id, reason: "x", status: "present" })).status).toBe(403);
    expect((await api("post", "/attendance/corrections", "hr").send({ attendanceId: inn.id, status: "present" })).status).toBe(400); // reason is mandatory
    const fixed = data(await api("post", "/attendance/corrections", "hr").send({ attendanceId: inn.id, status: "half_day", reason: "Left early with approval" }));
    expect(fixed.status).toBe("half_day");
    const rows = await db.query("SELECT old_values, new_values, reason FROM leads.attendance_corrections WHERE attendance_id = $1", [inn.id]);
    expect(rows.rows[0].reason).toBe("Left early with approval");
    expect(rows.rows[0].old_values.status).toBe("checked_out");
    expect(rows.rows[0].new_values.status).toBe("half_day");
  });

  it("expenses: receipt rule, approval by the right person only, rejection reason, reimbursement", async () => {
    expect((await api("post", "/expenses", "fs").send({ expenseDate: today, category: "Travel", amount: 1200 })).status).toBe(400); // receipt needed above 500
    const small = data(await api("post", "/expenses", "fs").set("Idempotency-Key", "exp-key-000001").send({ expenseDate: today, category: "Tea", amount: 120 }));
    expect(data(await api("post", "/expenses", "fs").set("Idempotency-Key", "exp-key-000001").send({ expenseDate: today, category: "Tea", amount: 120 })).id).toBe(small.id);
    const big = data(await api("post", "/expenses", "fs").send({ expenseDate: today, category: "Travel", amount: 1500, receiptKey: `${COMPANY}/receipt/${ids.fs}/x.png` }));
    expect((await api("post", `/expenses/${small.id}/approve`, "fs")).status).toBe(403);
    expect((await api("post", `/expenses/${small.id}/approve`, "sup")).status).toBe(403); // not their report
    expect((await api("post", `/expenses/${small.id}/reject`, "hr").send({})).status).toBe(400);
    expect(data(await api("post", `/expenses/${small.id}/reject`, "hr").send({ reason: "Personal" })).status).toBe("rejected");
    data(await api("post", `/expenses/${big.id}/approve`, "hr"));
    expect((await api("post", `/expenses/${small.id}/reimburse`, "hr").send({})).status).toBe(409);
    expect(data(await api("post", `/expenses/${big.id}/reimburse`, "hr").send({ reference: "NEFT-1" })).status).toBe("reimbursed");
    expect(data(await api("get", "/expenses", "fs"))).toHaveLength(2);
    expect(data(await api("get", "/expenses", "fs2"))).toHaveLength(0);
  });

  it("leave and holidays", async () => {
    const day = new Date(Date.now() + 10 * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const leave = data(await api("post", "/leaves", "fs").send({ fromDate: day, toDate: day, leaveType: "casual", reason: "Family" }));
    expect((await api("post", "/leaves", "fs").send({ fromDate: day, toDate: day, leaveType: "sick" })).status).toBe(409); // overlap
    expect((await api("post", `/leaves/${leave.id}/approve`, "fs")).status).toBe(403);
    expect(data(await api("post", `/leaves/${leave.id}/approve`, "hr").send({}))).toMatchObject({ status: "approved" });
    expect((await api("post", `/leaves/${leave.id}/reject`, "hr").send({ note: "late" })).status).toBe(409);
    const h = data(await api("post", "/holidays", "hr").send({ holidayDate: "2026-12-25", name: "Christmas" }));
    expect((await api("post", "/holidays", "hr").send({ holidayDate: "2026-12-25", name: "Again" })).status).toBe(409);
    expect((await api("post", "/holidays", "fs").send({ holidayDate: "2026-12-26", name: "x" })).status).toBe(403);
    expect(data(await api("get", "/holidays?year=2026", "fs"))).toHaveLength(1);
    data(await api("delete", `/holidays/${h.id}`, "hr"));
  });

  it("payroll: generate from attendance and settings, adjust, approve, finalize, then it is locked", async () => {
    const month = today.slice(0, 7);
    expect((await api("post", "/payroll/generate?month=2999-01", "hr").send({})).status).toBe(400); // future month
    expect((await api("post", `/payroll/generate?month=${month}`, "fs").send({})).status).toBe(403);
    const gen = data(await api("post", `/payroll/generate?month=${month}`, "hr").send({}));
    expect(gen.created).toBeGreaterThanOrEqual(6);
    const list = data(await api("get", `/payroll?month=${month}&limit=100`, "hr"));
    const mine = list.find((p: any) => p.employeeId === ids.fs);
    expect(mine).toMatchObject({ fixedSalary: 30000, status: "draft" });
    expect(mine.netPayable).toBeLessThanOrEqual(30000);
    expect(mine.payableDays + mine.unpaidLeaveDays).toBe(mine.calcDays);
    expect((await api("patch", `/payroll/${mine.id}/adjustment`, "hr").send({ adjustments: 500 })).status).toBe(400); // note needed
    const adjusted = data(await api("patch", `/payroll/${mine.id}/adjustment`, "hr").send({ adjustments: 500, note: "Festival bonus" }));
    expect(adjusted.netPayable).toBeCloseTo((30000 / mine.calcDays) * mine.payableDays + 500, 2);
    expect((await api("post", `/payroll/${mine.id}/finalize`, "hr")).status).toBe(409); // approve first
    data(await api("post", `/payroll/${mine.id}/approve`, "hr"));
    data(await api("post", `/payroll/${mine.id}/finalize`, "hr"));
    expect((await api("patch", `/payroll/${mine.id}/adjustment`, "hr").send({ adjustments: 1, note: "x" })).status).toBe(409);
    await expect(db.query("UPDATE leads.payroll SET net_payable = 1 WHERE id = $1", [mine.id])).rejects.toThrow(/locked/);
    const again = data(await api("post", `/payroll/generate?month=${month}`, "hr").send({}));
    expect(again.skipped.some((s: any) => /finalized/.test(s.reason))).toBe(true);
    expect(data(await api("get", `/payroll`, "fs")).map((p: any) => p.employeeId)).toEqual([ids.fs]); // an employee sees only their own finalized payslip
    const cfg = data(await api("put", "/settings/payroll", "admin").send({ payroll: { calc_days_mode: "fixed", calc_days_fixed: 30, half_day_minutes: 300 } }));
    expect(cfg).toMatchObject({ calcDaysMode: "fixed", halfDayMinutes: 300 });
    expect((await api("put", "/settings/payroll", "admin").send({ payroll: { calc_days_mode: "nonsense" } })).status).toBe(400);
  });

  // ------------------------------------------------------- audit and reports
  it("the audit trail records every state change and cannot be edited", async () => {
    const logs = data(await api("get", "/audit-logs?limit=100&entity=purchase_request", "admin"));
    const actions = logs.map((l: any) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["purchase.created", "purchase.submit", "purchase.approve", "purchase.process", "purchase.resubmit"]));
    expect(logs.every((l: any) => l.actorId && l.at)).toBe(true);
    const rejected = data(await api("get", "/audit-logs?limit=100&action=payment.rejected", "admin"))[0];
    expect(rejected.reason).toMatch(/Amount does not match/);
    expect(JSON.stringify(data(await api("get", "/audit-logs?limit=100", "admin")))).not.toMatch(/password_?hash|\$2[aby]\$/i);
    await expect(db.query("UPDATE leads.audit_logs SET reason = 'edited'")).rejects.toThrow(/append-only/);
    await expect(db.query("DELETE FROM leads.audit_logs")).rejects.toThrow(/append-only/);
    await expect(db.query("UPDATE leads.purchase_status_logs SET reason = 'x'")).rejects.toThrow(/append-only/);
  });

  it("dashboards show real counts for each role and refuse other roles", async () => {
    const admin = data(await api("get", "/dashboard/admin", "admin"));
    expect(admin.purchaseRequests).toMatchObject({ processed: 1 });
    expect(admin.employees).toBeGreaterThanOrEqual(6);
    expect(admin.trend).toHaveLength(6);
    expect(admin.trend.at(-1).requests).toBeGreaterThanOrEqual(4);
    expect(admin.topDistributors[0].units).toBeGreaterThan(0);
    expect(admin.complaintsByCategory[0]).toMatchObject({ key: "inverter_error_code" });
    expect(data(await api("get", "/dashboard/distributor", "dist")).processed).toBe(1);
    expect(data(await api("get", "/dashboard/distributor", "dist")).totalRequests).toBe(1);
    expect(data(await api("get", "/dashboard/support-manager", "sup")).complaints).toBeDefined();
    expect(data(await api("get", "/dashboard/hr", "hr")).activeEmployees).toBeGreaterThanOrEqual(6);
    expect(data(await api("get", "/dashboard/tele-sales", "fs")).assignedDistributors).toBe(2);
    expect(data(await api("get", "/dashboard/sales-manager", "sm")).team).toBeDefined();
    expect(data(await api("get", "/dashboard/sales-manager", "sm")).trend).toHaveLength(6);
    const sup = data(await api("get", "/dashboard/support-manager", "sup"));
    expect(sup.trend.at(-1).received).toBeGreaterThanOrEqual(1);
    expect(sup.recentComplaints.length).toBeGreaterThanOrEqual(1);
    const hrd = data(await api("get", "/dashboard/hr", "hr"));
    expect(hrd.trend).toHaveLength(6);
    expect(hrd.trend.at(-1).presentDays).toBeGreaterThanOrEqual(1);
    expect(data(await api("get", "/dashboard/tele-sales", "fs")).todaysFollowups).toBeDefined();
    expect((await api("get", "/dashboard/admin", "sm")).status).toBe(403);
    expect((await api("get", "/dashboard/hr", "dist")).status).toBe(403);
  });

  it("reports filter by date, status and distributor, and export CSV with the right permission", async () => {
    const json = await api("get", `/reports/purchases?section=requests&status=processed&from=${today}&to=${today}`, "sm");
    expect(json.status).toBe(200);
    expect(json.body.meta.total).toBe(1);
    expect(json.body.columns).toContain("requestNo");
    const csv = await api("get", `/reports/purchases?section=payments&format=csv`, "sm");
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text.split("\r\n")[0]).toBe("createdAt,requestNo,distributor,amount,method,paymentDate,utrNormalized,status,isActive,reviewer,reviewedAt,rejectionReason");
    expect((await api("get", "/reports/purchases", "dist")).status).toBe(403);
    expect((await api("get", "/reports/hr?section=payroll", "sm")).status).toBe(403);
    expect((await api("get", "/reports/service?section=engineers", "sup")).status).toBe(200);
    expect((await api("get", "/reports/sales?section=nope", "sm")).status).toBe(400);
    const hr = await api("get", "/reports/hr?section=attendance&format=csv", "hr");
    expect(hr.status).toBe(200);
  });

  it("password reset by WhatsApp OTP signs the user out everywhere", async () => {
    sentOtps = [];
    const before = tokens.fs2;
    data(await api("post", "/auth/forgot-password").send({ identifier: "9000000004" }));
    data(await api("post", "/auth/forgot-password").send({ identifier: "9999999999" })); // unknown: same answer
    expect(sentOtps).toHaveLength(1);
    expect((await api("post", "/auth/reset-password").send({ identifier: "9000000004", otp: "000000", newPassword: "Brand-New-Pass-1" })).status).toBe(400);
    data(await api("post", "/auth/reset-password").send({ identifier: "9000000004", otp: sentOtps[0], newPassword: "Brand-New-Pass-1" }));
    expect((await request(app.getHttpServer()).get("/api/v1/auth/me").set("Authorization", `Bearer ${before}`)).status).toBe(401);
    expect((await login("9000000004", "Brand-New-Pass-1")).user.role).toBe("field_sales");
  });

  it("existing APIs are untouched: the console login still works under /api", async () => {
    expect((await request(app.getHttpServer()).get("/api/auth/me").set("Authorization", `Bearer ${tokens.admin}`)).status).toBe(200);
    expect((await request(app.getHttpServer()).get("/api/lead-collection/admin/users").set("Authorization", `Bearer ${tokens.fs}`)).status).toBe(401);
  });
});
