-- Eco Sor Business Operations Platform, part 1 of 6: roles, permissions, employees, products, distributors.
-- Conventions follow 0001-0003: schema "leads", text COLLATE "C" ids, timestamptz, RLS on, no grants to anon/authenticated.
-- Enums are text + CHECK. Dates without time are text 'YYYY-MM-DD' (like lead_attendances.date). Numbers are double precision
-- because the model registry maps every number to that type (npm run db:verify enforces it).
-- Shared helpers ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION "leads".set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW."updated_at" := now(); RETURN NEW; END $$;
COMMENT ON FUNCTION "leads".set_updated_at() IS 'Keeps updated_at current on every UPDATE of an Eco Sor table.';

CREATE OR REPLACE FUNCTION "leads".forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% on %.% is not allowed: this table is append-only', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege'; END $$;
COMMENT ON FUNCTION "leads".forbid_change() IS 'Trigger that rejects UPDATE, DELETE and TRUNCATE; used on audit and status-history tables.';

CREATE TABLE "leads"."roles" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "code" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "description" text COLLATE "C" NOT NULL DEFAULT '',
  "is_system" boolean NOT NULL DEFAULT true,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "roles_1_chk" CHECK ("code" ~ '^[a-z][a-z0-9_]*$')
);
COMMENT ON TABLE "leads"."roles" IS 'Eco Sor roles per company (admin, sales_manager, tele_sales, field_sales, support_manager, field_support, hr, distributor, customer). Linked from lead_users.role_id and employees.role_id.';
ALTER TABLE "leads"."roles" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "roles__set_updated_at" BEFORE UPDATE ON "leads"."roles" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "roles_company_id_code_key" ON "leads"."roles" USING btree ("company_id", "code");
REVOKE ALL ON "leads"."roles" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."roles" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."permissions" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "code" text COLLATE "C" NOT NULL,
  "module" text COLLATE "C" NOT NULL,
  "description" text COLLATE "C" NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "permissions_1_chk" CHECK ("code" ~ '^[a-z_]+\.[a-z_]+$')
);
COMMENT ON TABLE "leads"."permissions" IS 'Catalogue of permission codes (module.action), shared by all companies. A role''s grants are in role_permissions.';
ALTER TABLE "leads"."permissions" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "permissions__set_updated_at" BEFORE UPDATE ON "leads"."permissions" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "permissions_code_key" ON "leads"."permissions" USING btree ("code");
CREATE INDEX "permissions_module_idx" ON "leads"."permissions" USING btree ("module");
REVOKE ALL ON "leads"."permissions" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."permissions" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."role_permissions" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "role_id" text COLLATE "C" NOT NULL REFERENCES "leads"."roles"("id") ON DELETE CASCADE,
  "permission_id" text COLLATE "C" NOT NULL REFERENCES "leads"."permissions"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb
);
COMMENT ON TABLE "leads"."role_permissions" IS 'Which permissions each role holds (many-to-many between roles and permissions).';
ALTER TABLE "leads"."role_permissions" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "role_permissions__set_updated_at" BEFORE UPDATE ON "leads"."role_permissions" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "role_permissions_role_id_permission_id_key" ON "leads"."role_permissions" USING btree ("role_id", "permission_id");
CREATE INDEX "role_permissions_company_id_idx" ON "leads"."role_permissions" USING btree ("company_id");
CREATE INDEX "role_permissions_permission_id_idx" ON "leads"."role_permissions" USING btree ("permission_id");
REVOKE ALL ON "leads"."role_permissions" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."role_permissions" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."employees" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "user_id" text COLLATE "C" NOT NULL REFERENCES "leads"."lead_users"("id"),
  "employee_code" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "mobile" text COLLATE "C" NOT NULL,
  "email" text COLLATE "C",
  "address" text COLLATE "C",
  "photo_url" text COLLATE "C",
  "designation" text COLLATE "C",
  "department" text COLLATE "C",
  "role_id" text COLLATE "C" REFERENCES "leads"."roles"("id"),
  "manager_id" text COLLATE "C" REFERENCES "leads"."employees"("id"),
  "joining_date" text COLLATE "C",
  "fixed_salary" double precision NOT NULL DEFAULT 0,
  "weekly_off" text[] COLLATE "C" NOT NULL DEFAULT ARRAY['sunday']::text[],
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "employees_1_chk" CHECK ("manager_id" IS NULL OR "manager_id" <> "id"),
  CONSTRAINT "employees_2_chk" CHECK ("joining_date" ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT "employees_3_chk" CHECK ("fixed_salary" >= 0),
  CONSTRAINT "employees_4_chk" CHECK ("weekly_off" <@ ARRAY['monday','tuesday','wednesday','thursday','friday','saturday','sunday']::text[])
);
COMMENT ON TABLE "leads"."employees" IS 'Eco Sor employee master. One row per staff login in lead_users (user_id); holds HR and reporting-line data.';
ALTER TABLE "leads"."employees" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "employees__set_updated_at" BEFORE UPDATE ON "leads"."employees" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "employees_company_id_employee_code_key" ON "leads"."employees" USING btree ("company_id", "employee_code");
CREATE UNIQUE INDEX "employees_user_id_key" ON "leads"."employees" USING btree ("user_id");
CREATE INDEX "employees_company_id_is_active_idx" ON "leads"."employees" USING btree ("company_id", "is_active");
CREATE INDEX "employees_company_id_name_idx" ON "leads"."employees" USING btree ("company_id", "name");
CREATE INDEX "employees_role_id_idx" ON "leads"."employees" USING btree ("role_id");
CREATE INDEX "employees_manager_id_idx" ON "leads"."employees" USING btree ("manager_id");
CREATE INDEX "employees_joining_date_idx" ON "leads"."employees" USING btree ("joining_date");
CREATE INDEX "employees_created_by_idx" ON "leads"."employees" USING btree ("created_by");
REVOKE ALL ON "leads"."employees" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."employees" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."products" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "product_code" text COLLATE "C" NOT NULL,
  "category" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "model" text COLLATE "C" NOT NULL,
  "sku" text COLLATE "C" NOT NULL,
  "description" text COLLATE "C",
  "image_url" text COLLATE "C",
  "is_active" boolean NOT NULL DEFAULT true,
  "created_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "products_1_chk" CHECK ("category" IN ('inverter', 'battery'))
);
COMMENT ON TABLE "leads"."products" IS 'Product master: inverters and batteries a distributor can order. Purchase items keep their own name/model/sku snapshot, so edits never rewrite history.';
ALTER TABLE "leads"."products" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "products__set_updated_at" BEFORE UPDATE ON "leads"."products" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "products_company_id_sku_key" ON "leads"."products" USING btree ("company_id", "sku");
CREATE UNIQUE INDEX "products_company_id_product_code_key" ON "leads"."products" USING btree ("company_id", "product_code");
CREATE INDEX "products_company_id_category_is_active_idx" ON "leads"."products" USING btree ("company_id", "category", "is_active");
CREATE INDEX "products_created_by_idx" ON "leads"."products" USING btree ("created_by");
REVOKE ALL ON "leads"."products" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."products" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."distributors" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "distributor_code" text COLLATE "C" NOT NULL,
  "firm_name" text COLLATE "C" NOT NULL,
  "contact_person" text COLLATE "C" NOT NULL,
  "mobile" text COLLATE "C" NOT NULL,
  "alt_mobile" text COLLATE "C",
  "email" text COLLATE "C",
  "gstin" text COLLATE "C",
  "address" text COLLATE "C",
  "city" text COLLATE "C",
  "state" text COLLATE "C",
  "pin" text COLLATE "C",
  "assigned_executive_id" text COLLATE "C" REFERENCES "leads"."employees"("id"),
  "remarks" text COLLATE "C",
  "is_active" boolean NOT NULL DEFAULT true,
  "portal_access" boolean NOT NULL DEFAULT false,
  "user_id" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "created_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "distributors_1_chk" CHECK (NOT "portal_access" OR "user_id" IS NOT NULL),
  CONSTRAINT "distributors_2_chk" CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9A-Z]{15}$'),
  CONSTRAINT "distributors_3_chk" CHECK ("pin" IS NULL OR "pin" ~ '^[0-9]{6}$')
);
COMMENT ON TABLE "leads"."distributors" IS 'Distributor master. assigned_executive_id is the current sales owner; user_id is the portal login when portal_access is on.';
ALTER TABLE "leads"."distributors" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "distributors__set_updated_at" BEFORE UPDATE ON "leads"."distributors" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "distributors_company_id_distributor_code_key" ON "leads"."distributors" USING btree ("company_id", "distributor_code");
CREATE UNIQUE INDEX "distributors_user_id_key" ON "leads"."distributors" USING btree ("user_id") WHERE "user_id" IS NOT NULL;
CREATE INDEX "distributors_company_id_is_active_idx" ON "leads"."distributors" USING btree ("company_id", "is_active");
CREATE INDEX "distributors_company_id_firm_name_idx" ON "leads"."distributors" USING btree ("company_id", "firm_name");
CREATE INDEX "distributors_company_id_state_city_idx" ON "leads"."distributors" USING btree ("company_id", "state", "city");
CREATE INDEX "distributors_company_id_mobile_idx" ON "leads"."distributors" USING btree ("company_id", "mobile");
CREATE INDEX "distributors_assigned_executive_id_idx" ON "leads"."distributors" USING btree ("assigned_executive_id");
CREATE INDEX "distributors_user_id_idx" ON "leads"."distributors" USING btree ("user_id");
CREATE INDEX "distributors_created_by_idx" ON "leads"."distributors" USING btree ("created_by");
REVOKE ALL ON "leads"."distributors" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."distributors" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."distributor_assignments" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "distributor_id" text COLLATE "C" NOT NULL REFERENCES "leads"."distributors"("id"),
  "employee_id" text COLLATE "C" NOT NULL REFERENCES "leads"."employees"("id"),
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  "unassigned_at" timestamptz,
  "assigned_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "reason" text COLLATE "C",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "distributor_assignments_1_chk" CHECK ("unassigned_at" IS NULL OR "unassigned_at" >= "assigned_at")
);
COMMENT ON TABLE "leads"."distributor_assignments" IS 'History of which employee looked after which distributor. At most one open row (unassigned_at IS NULL) per distributor.';
ALTER TABLE "leads"."distributor_assignments" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "distributor_assignments__set_updated_at" BEFORE UPDATE ON "leads"."distributor_assignments" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "distributor_assignments_distributor_id_key" ON "leads"."distributor_assignments" USING btree ("distributor_id") WHERE "unassigned_at" IS NULL;
CREATE INDEX "distributor_assignments_employee_id_assigned_at_idx" ON "leads"."distributor_assignments" USING btree ("employee_id", "assigned_at");
CREATE INDEX "distributor_assignments_company_id_idx" ON "leads"."distributor_assignments" USING btree ("company_id");
CREATE INDEX "distributor_assignments_distributor_id_idx" ON "leads"."distributor_assignments" USING btree ("distributor_id");
CREATE INDEX "distributor_assignments_assigned_at_idx" ON "leads"."distributor_assignments" USING btree ("assigned_at");
CREATE INDEX "distributor_assignments_assigned_by_idx" ON "leads"."distributor_assignments" USING btree ("assigned_by");
REVOKE ALL ON "leads"."distributor_assignments" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."distributor_assignments" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."doc_counters" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "kind" text COLLATE "C" NOT NULL,
  "year" double precision NOT NULL,
  "last_value" double precision NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "doc_counters_1_chk" CHECK ("kind" ~ '^[A-Z]{2,5}$'),
  CONSTRAINT "doc_counters_2_chk" CHECK ("year" = trunc("year")),
  CONSTRAINT "doc_counters_3_chk" CHECK ("year" >= 2000),
  CONSTRAINT "doc_counters_4_chk" CHECK ("year" <= 2999),
  CONSTRAINT "doc_counters_5_chk" CHECK ("last_value" = trunc("last_value")),
  CONSTRAINT "doc_counters_6_chk" CHECK ("last_value" >= 0)
);
COMMENT ON TABLE "leads"."doc_counters" IS 'Per-company, per-year counters behind human IDs such as PR-2026-000001; use leads.next_doc_no().';
ALTER TABLE "leads"."doc_counters" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "doc_counters__set_updated_at" BEFORE UPDATE ON "leads"."doc_counters" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "doc_counters_company_id_kind_year_key" ON "leads"."doc_counters" USING btree ("company_id", "kind", "year");
REVOKE ALL ON "leads"."doc_counters" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."doc_counters" FROM %s', r); END IF; END LOOP; END $$;


-- Existing staff table (lead_users): link to roles, add an active flag ---------
ALTER TABLE "leads"."lead_users" ADD COLUMN IF NOT EXISTS "role_id" text COLLATE "C" REFERENCES "leads"."roles"("id");
ALTER TABLE "leads"."lead_users" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS "lead_users_role_id_idx" ON "leads"."lead_users" USING btree ("role_id");
CREATE INDEX IF NOT EXISTS "lead_users_company_active_idx" ON "leads"."lead_users" USING btree ("company_id", "is_active");
COMMENT ON COLUMN "leads"."lead_users"."role_id" IS 'Eco Sor role (roles.id). The older free-text "role" column is unchanged.';
COMMENT ON COLUMN "leads"."lead_users"."is_active" IS 'false blocks sign-in without deleting the account.';

-- Human-readable document numbers: PR-2026-000001, CMP-2026-000001 -----------
CREATE OR REPLACE FUNCTION "leads".next_doc_no(p_company text, p_kind text, p_year integer DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE y integer := coalesce(p_year, extract(year FROM now())::integer); n double precision;
BEGIN
  INSERT INTO "leads"."doc_counters" ("company_id", "kind", "year", "last_value") VALUES (p_company, p_kind, y, 1)
  ON CONFLICT ("company_id", "kind", "year") DO UPDATE SET "last_value" = "leads"."doc_counters"."last_value" + 1
  RETURNING "last_value" INTO n;
  RETURN p_kind || '-' || y || '-' || lpad(n::bigint::text, 6, '0');
END $$;
COMMENT ON FUNCTION "leads".next_doc_no(text, text, integer) IS 'Next gap-free-per-transaction document number for a company, e.g. next_doc_no(company, ''PR'') -> PR-2026-000001.';
