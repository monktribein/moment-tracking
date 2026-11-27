/**
 * npm run db:seed                 load database/seeds/eco_seed.sql (Eco Sor demo company)
 * npm run db:seed -- --dry-run    run it in a transaction and roll back (validates the file)
 *
 * Every seeded login (the Super Admin and the 8 employees) gets one password: ECO_SEED_PASSWORD
 * from the environment, or a random one printed once. It is bcrypt-hashed here; the SQL file
 * holds only a placeholder. Change the password after the first sign-in.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { BACKEND_DIR, connect, redact } = require("./lib");

const dry = process.argv.includes("--dry-run");

(async () => {
  const bcrypt = require(path.join(BACKEND_DIR, "node_modules/bcryptjs"));
  const generated = !process.env.ECO_SEED_PASSWORD;
  const password = process.env.ECO_SEED_PASSWORD || crypto.randomBytes(9).toString("base64url");
  const hash = bcrypt.hashSync(password, 10);
  const sql = fs.readFileSync(path.join(__dirname, "seeds", "eco_seed.sql"), "utf8").replace(/\{\{PASSWORD_HASH\}\}/g, hash);
  const c = await connect("movement-tracking-db-seed");
  try {
    await c.query("BEGIN");
    await c.query(sql);
    const counts = (
      await c.query(`SELECT
        (SELECT count(*) FROM "leads"."roles" WHERE "company_id" = 'ec05000000000000000000c0') roles,
        (SELECT count(*) FROM "leads"."role_permissions" WHERE "company_id" = 'ec05000000000000000000c0') role_permissions,
        (SELECT count(*) FROM "leads"."products" WHERE "company_id" = 'ec05000000000000000000c0') products,
        (SELECT count(*) FROM "leads"."distributors" WHERE "company_id" = 'ec05000000000000000000c0') distributors,
        (SELECT count(*) FROM "leads"."employees" WHERE "company_id" = 'ec05000000000000000000c0') employees,
        (SELECT count(*) FROM "leads"."holidays" WHERE "company_id" = 'ec05000000000000000000c0') holidays`)
    ).rows[0];
    await c.query(dry ? "ROLLBACK" : "COMMIT");
    console.log(dry ? "dry run (rolled back):" : "seeded:", JSON.stringify(counts));
    if (!dry) {
      console.log("Super Admin sign-in: admin@ecosor.example  (employees sign in with their mobile 9000000001-9000000008)");
      if (generated) console.log(`Password (shown once): ${password}`);
    }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error("FAILED:", redact(e && e.message ? e.message : e));
  process.exit(1);
});
