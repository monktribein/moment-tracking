-- Movement Tracking baseline schema (6 tables in schema "leads").
-- Five lead tables (leads, field agents, regions, attendance, GPS points); admin_users holds the Super Admin console accounts.
-- Generated from src/database/pg/registry.generated.ts with src/database/pg/ddl.ts (schemaDdl). Apply with: npm run db:migrate

BEGIN;

CREATE SCHEMA IF NOT EXISTS "leads";

REVOKE ALL ON SCHEMA "leads" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON SCHEMA "leads" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."lead_attendances" (
  "id" text COLLATE "C" PRIMARY KEY,
  "agent_id" text COLLATE "C",
  "agent_name" text COLLATE "C",
  "agent_phone" text COLLATE "C",
  "role" text COLLATE "C",
  "state" text COLLATE "C",
  "district" text COLLATE "C",
  "date" text COLLATE "C",
  "checked_in" boolean,
  "check_in_time" timestamptz,
  "check_in_formatted_time" text COLLATE "C",
  "check_in_coords" jsonb,
  "check_in_address" text COLLATE "C",
  "check_in_maps_url" text COLLATE "C",
  "checked_out" boolean,
  "check_out_time" timestamptz,
  "check_out_formatted_time" text COLLATE "C",
  "check_out_coords" jsonb,
  "check_out_address" text COLLATE "C",
  "check_out_maps_url" text COLLATE "C",
  "total_working_minutes" double precision,
  "formatted_working_hours" text COLLATE "C",
  "status" text COLLATE "C",
  "notes" text COLLATE "C",
  "created_at" timestamptz,
  "updated_at" timestamptz,
  "version" double precision,
  "user_id" text COLLATE "C",
  "distance_km" double precision,
  "tracked_points" double precision,
  "distance_measured_at" timestamptz,
  "_nulls" text[],
  "_extra" jsonb
);
COMMENT ON TABLE "leads"."lead_attendances" IS 'Model collection lead_attendances. Layout: src/database/pg/registry.generated.ts';
COMMENT ON COLUMN "leads"."lead_attendances"."agent_id" IS 'model field: agentId';
COMMENT ON COLUMN "leads"."lead_attendances"."agent_name" IS 'model field: agentName';
COMMENT ON COLUMN "leads"."lead_attendances"."agent_phone" IS 'model field: agentPhone';
COMMENT ON COLUMN "leads"."lead_attendances"."checked_in" IS 'model field: checkedIn';
COMMENT ON COLUMN "leads"."lead_attendances"."check_in_time" IS 'model field: checkInTime';
COMMENT ON COLUMN "leads"."lead_attendances"."check_in_formatted_time" IS 'model field: checkInFormattedTime';
COMMENT ON COLUMN "leads"."lead_attendances"."check_in_coords" IS 'model field: checkInCoords';
COMMENT ON COLUMN "leads"."lead_attendances"."check_in_address" IS 'model field: checkInAddress';
COMMENT ON COLUMN "leads"."lead_attendances"."check_in_maps_url" IS 'model field: checkInMapsUrl';
COMMENT ON COLUMN "leads"."lead_attendances"."checked_out" IS 'model field: checkedOut';
COMMENT ON COLUMN "leads"."lead_attendances"."check_out_time" IS 'model field: checkOutTime';
COMMENT ON COLUMN "leads"."lead_attendances"."check_out_formatted_time" IS 'model field: checkOutFormattedTime';
COMMENT ON COLUMN "leads"."lead_attendances"."check_out_coords" IS 'model field: checkOutCoords';
COMMENT ON COLUMN "leads"."lead_attendances"."check_out_address" IS 'model field: checkOutAddress';
COMMENT ON COLUMN "leads"."lead_attendances"."check_out_maps_url" IS 'model field: checkOutMapsUrl';
COMMENT ON COLUMN "leads"."lead_attendances"."total_working_minutes" IS 'model field: totalWorkingMinutes';
COMMENT ON COLUMN "leads"."lead_attendances"."formatted_working_hours" IS 'model field: formattedWorkingHours';
COMMENT ON COLUMN "leads"."lead_attendances"."created_at" IS 'model field: createdAt';
COMMENT ON COLUMN "leads"."lead_attendances"."updated_at" IS 'model field: updatedAt';
COMMENT ON COLUMN "leads"."lead_attendances"."version" IS 'model field: __v';
COMMENT ON COLUMN "leads"."lead_attendances"."user_id" IS 'model field: userId';
COMMENT ON COLUMN "leads"."lead_attendances"."distance_km" IS 'model field: distanceKm';
COMMENT ON COLUMN "leads"."lead_attendances"."tracked_points" IS 'model field: trackedPoints';
COMMENT ON COLUMN "leads"."lead_attendances"."distance_measured_at" IS 'model field: distanceMeasuredAt';
ALTER TABLE "leads"."lead_attendances" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "lead_attendances_extra_80d8ff9c" ON "leads"."lead_attendances" USING gin ("_extra") WHERE "_extra" IS NOT NULL;
CREATE INDEX "lead_attendances_ix_09369b3a" ON "leads"."lead_attendances" USING btree ("agent_id");
CREATE INDEX "lead_attendances_ix_c92df131" ON "leads"."lead_attendances" USING btree ("state");
CREATE INDEX "lead_attendances_ix_b4d65e09" ON "leads"."lead_attendances" USING btree ("district");
CREATE INDEX "lead_attendances_ix_d0644476" ON "leads"."lead_attendances" USING btree ("date");
CREATE INDEX "lead_attendances_ix_20b3ed65" ON "leads"."lead_attendances" USING btree ("status");
CREATE UNIQUE INDEX "lead_attendances_uq_6f03647f" ON "leads"."lead_attendances" USING btree ("agent_id", "date") NULLS NOT DISTINCT;
CREATE INDEX "lead_attendances_ix_02782f2e" ON "leads"."lead_attendances" USING btree ("date", "district");
CREATE INDEX "lead_attendances_ix_67bad42f" ON "leads"."lead_attendances" USING btree ("created_at" DESC NULLS LAST);
CREATE INDEX "lead_attendances_ix_a956d22b" ON "leads"."lead_attendances" USING btree ("date" DESC NULLS LAST, "state", "district");

REVOKE ALL ON "leads"."lead_attendances" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."lead_attendances" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."lead_location_pings" (
  "id" text COLLATE "C" PRIMARY KEY,
  "agent_id" text COLLATE "C",
  "agent_name" text COLLATE "C",
  "state" text COLLATE "C",
  "district" text COLLATE "C",
  "date" text COLLATE "C",
  "lat" double precision,
  "lng" double precision,
  "accuracy" double precision,
  "speed" double precision,
  "heading" double precision,
  "altitude" double precision,
  "recorded_at" timestamptz,
  "metres_from_previous" double precision,
  "source" text COLLATE "C",
  "created_at" timestamptz,
  "updated_at" timestamptz,
  "version" double precision,
  "_nulls" text[],
  "_extra" jsonb
);
COMMENT ON TABLE "leads"."lead_location_pings" IS 'Model collection lead_location_pings. Layout: src/database/pg/registry.generated.ts';
COMMENT ON COLUMN "leads"."lead_location_pings"."agent_id" IS 'model field: agentId';
COMMENT ON COLUMN "leads"."lead_location_pings"."agent_name" IS 'model field: agentName';
COMMENT ON COLUMN "leads"."lead_location_pings"."recorded_at" IS 'model field: recordedAt';
COMMENT ON COLUMN "leads"."lead_location_pings"."metres_from_previous" IS 'model field: metresFromPrevious';
COMMENT ON COLUMN "leads"."lead_location_pings"."created_at" IS 'model field: createdAt';
COMMENT ON COLUMN "leads"."lead_location_pings"."updated_at" IS 'model field: updatedAt';
COMMENT ON COLUMN "leads"."lead_location_pings"."version" IS 'model field: __v';
ALTER TABLE "leads"."lead_location_pings" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "lead_location_pings_extra_ac26da40" ON "leads"."lead_location_pings" USING gin ("_extra") WHERE "_extra" IS NOT NULL;
CREATE INDEX "lead_location_pings_ix_09369b3a" ON "leads"."lead_location_pings" USING btree ("agent_id");
CREATE INDEX "lead_location_pings_ix_c92df131" ON "leads"."lead_location_pings" USING btree ("state");
CREATE INDEX "lead_location_pings_ix_b4d65e09" ON "leads"."lead_location_pings" USING btree ("district");
CREATE INDEX "lead_location_pings_ix_d0644476" ON "leads"."lead_location_pings" USING btree ("date");
CREATE INDEX "lead_location_pings_ix_9356a362" ON "leads"."lead_location_pings" USING btree ("agent_id", "date", "recorded_at");
CREATE INDEX "lead_location_pings_ix_40cf2a19" ON "leads"."lead_location_pings" USING btree ("district", "recorded_at" DESC NULLS LAST);
CREATE UNIQUE INDEX "lead_location_pings_uq_82d0d968" ON "leads"."lead_location_pings" USING btree ("agent_id", "recorded_at") NULLS NOT DISTINCT;
CREATE INDEX "lead_location_pings_ix_3ee1b8eb" ON "leads"."lead_location_pings" USING btree ("recorded_at");

REVOKE ALL ON "leads"."lead_location_pings" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."lead_location_pings" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."lead_regions" (
  "id" text COLLATE "C" PRIMARY KEY,
  "state" text COLLATE "C",
  "district" text COLLATE "C",
  "created_by_admin_id" text COLLATE "C",
  "created_by_admin_name" text COLLATE "C",
  "created_at" timestamptz,
  "updated_at" timestamptz,
  "_nulls" text[],
  "_extra" jsonb
);
COMMENT ON TABLE "leads"."lead_regions" IS 'Model collection lead_regions. Layout: src/database/pg/registry.generated.ts';
COMMENT ON COLUMN "leads"."lead_regions"."created_by_admin_id" IS 'model field: createdByAdminId';
COMMENT ON COLUMN "leads"."lead_regions"."created_by_admin_name" IS 'model field: createdByAdminName';
COMMENT ON COLUMN "leads"."lead_regions"."created_at" IS 'model field: createdAt';
COMMENT ON COLUMN "leads"."lead_regions"."updated_at" IS 'model field: updatedAt';
ALTER TABLE "leads"."lead_regions" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "lead_regions_extra_83502c51" ON "leads"."lead_regions" USING gin ("_extra") WHERE "_extra" IS NOT NULL;
CREATE UNIQUE INDEX "lead_regions_uq_dd49a283" ON "leads"."lead_regions" USING btree ("state", "district") NULLS NOT DISTINCT;

REVOKE ALL ON "leads"."lead_regions" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."lead_regions" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."lead_users" (
  "id" text COLLATE "C" PRIMARY KEY,
  "name" text COLLATE "C",
  "phone" text COLLATE "C",
  "email" text COLLATE "C",
  "password_hash" text COLLATE "C",
  "role" text COLLATE "C",
  "status" text COLLATE "C",
  "region" text COLLATE "C",
  "state" text COLLATE "C",
  "district" text COLLATE "C",
  "employee_code" text COLLATE "C",
  "notes" text COLLATE "C",
  "last_login_at" timestamptz,
  "token_version" double precision,
  "created_by_admin_id" text COLLATE "C",
  "created_by_admin_name" text COLLATE "C",
  "tracking_consent" jsonb,
  "created_at" timestamptz,
  "updated_at" timestamptz,
  "version" double precision,
  "_nulls" text[],
  "_extra" jsonb
);
COMMENT ON TABLE "leads"."lead_users" IS 'Model collection lead_users. Layout: src/database/pg/registry.generated.ts';
COMMENT ON COLUMN "leads"."lead_users"."password_hash" IS 'model field: passwordHash';
COMMENT ON COLUMN "leads"."lead_users"."employee_code" IS 'model field: employeeCode';
COMMENT ON COLUMN "leads"."lead_users"."last_login_at" IS 'model field: lastLoginAt';
COMMENT ON COLUMN "leads"."lead_users"."token_version" IS 'model field: tokenVersion';
COMMENT ON COLUMN "leads"."lead_users"."created_by_admin_id" IS 'model field: createdByAdminId';
COMMENT ON COLUMN "leads"."lead_users"."created_by_admin_name" IS 'model field: createdByAdminName';
COMMENT ON COLUMN "leads"."lead_users"."tracking_consent" IS 'model field: trackingConsent';
COMMENT ON COLUMN "leads"."lead_users"."created_at" IS 'model field: createdAt';
COMMENT ON COLUMN "leads"."lead_users"."updated_at" IS 'model field: updatedAt';
COMMENT ON COLUMN "leads"."lead_users"."version" IS 'model field: __v';
ALTER TABLE "leads"."lead_users" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "lead_users_extra_69856cb2" ON "leads"."lead_users" USING gin ("_extra") WHERE "_extra" IS NOT NULL;
CREATE UNIQUE INDEX "lead_users_uq_d4eaaa3f" ON "leads"."lead_users" USING btree ("phone") NULLS NOT DISTINCT;
CREATE INDEX "lead_users_ix_20b3ed65" ON "leads"."lead_users" USING btree ("status");
CREATE INDEX "lead_users_ix_c92df131" ON "leads"."lead_users" USING btree ("state");
CREATE INDEX "lead_users_ix_b4d65e09" ON "leads"."lead_users" USING btree ("district");
CREATE INDEX "lead_users_ix_82abfc2f" ON "leads"."lead_users" USING btree ("status", "created_at" DESC NULLS LAST);
CREATE INDEX "lead_users_ix_e5b8dfb3" ON "leads"."lead_users" USING btree ("name");

REVOKE ALL ON "leads"."lead_users" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."lead_users" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."leads" (
  "id" text COLLATE "C" PRIMARY KEY,
  "name" text COLLATE "C",
  "location" jsonb,
  "geo" jsonb,
  "room_inventory" jsonb,
  "contact" jsonb,
  "notes" text COLLATE "C",
  "agent_notes" text COLLATE "C",
  "interest" text COLLATE "C",
  "meeting" jsonb,
  "images" jsonb,
  "status" text COLLATE "C",
  "captured_by" text COLLATE "C",
  "captured_by_name" text COLLATE "C",
  "captured_at" timestamptz,
  "assigned_agent_id" text COLLATE "C",
  "assigned_agent_name" text COLLATE "C",
  "assigned_agent_code" text COLLATE "C",
  "field_verified" boolean,
  "field_verified_at" timestamptz,
  "field_verified_by_name" text COLLATE "C",
  "field_verified_by_id" text COLLATE "C",
  "last_updated_by_name" text COLLATE "C",
  "last_updated_by_role" text COLLATE "C",
  "document_checklist" jsonb,
  "document_category" text COLLATE "C",
  "doc_verification_status" text COLLATE "C",
  "document_verified" boolean,
  "doc_verified_at" timestamptz,
  "doc_verified_by_name" text COLLATE "C",
  "doc_verified_by_id" text COLLATE "C",
  "doc_verification_notes" text COLLATE "C",
  "reviewed_by_admin_id" text COLLATE "C",
  "reviewed_by_admin_name" text COLLATE "C",
  "reviewed_at" timestamptz,
  "review_note" text COLLATE "C",
  "created_at" timestamptz,
  "updated_at" timestamptz,
  "version" double precision,
  "_nulls" text[],
  "_extra" jsonb
);
COMMENT ON TABLE "leads"."leads" IS 'Model collection leads. Layout: src/database/pg/registry.generated.ts';
COMMENT ON COLUMN "leads"."leads"."room_inventory" IS 'model field: roomInventory';
COMMENT ON COLUMN "leads"."leads"."agent_notes" IS 'model field: agentNotes';
COMMENT ON COLUMN "leads"."leads"."captured_by" IS 'model field: capturedBy';
COMMENT ON COLUMN "leads"."leads"."captured_by_name" IS 'model field: capturedByName';
COMMENT ON COLUMN "leads"."leads"."captured_at" IS 'model field: capturedAt';
COMMENT ON COLUMN "leads"."leads"."assigned_agent_id" IS 'model field: assignedAgentId';
COMMENT ON COLUMN "leads"."leads"."assigned_agent_name" IS 'model field: assignedAgentName';
COMMENT ON COLUMN "leads"."leads"."assigned_agent_code" IS 'model field: assignedAgentCode';
COMMENT ON COLUMN "leads"."leads"."field_verified" IS 'model field: fieldVerified';
COMMENT ON COLUMN "leads"."leads"."field_verified_at" IS 'model field: fieldVerifiedAt';
COMMENT ON COLUMN "leads"."leads"."field_verified_by_name" IS 'model field: fieldVerifiedByName';
COMMENT ON COLUMN "leads"."leads"."field_verified_by_id" IS 'model field: fieldVerifiedById';
COMMENT ON COLUMN "leads"."leads"."last_updated_by_name" IS 'model field: lastUpdatedByName';
COMMENT ON COLUMN "leads"."leads"."last_updated_by_role" IS 'model field: lastUpdatedByRole';
COMMENT ON COLUMN "leads"."leads"."document_checklist" IS 'model field: documentChecklist';
COMMENT ON COLUMN "leads"."leads"."document_category" IS 'model field: documentCategory';
COMMENT ON COLUMN "leads"."leads"."doc_verification_status" IS 'model field: docVerificationStatus';
COMMENT ON COLUMN "leads"."leads"."document_verified" IS 'model field: documentVerified';
COMMENT ON COLUMN "leads"."leads"."doc_verified_at" IS 'model field: docVerifiedAt';
COMMENT ON COLUMN "leads"."leads"."doc_verified_by_name" IS 'model field: docVerifiedByName';
COMMENT ON COLUMN "leads"."leads"."doc_verified_by_id" IS 'model field: docVerifiedById';
COMMENT ON COLUMN "leads"."leads"."doc_verification_notes" IS 'model field: docVerificationNotes';
COMMENT ON COLUMN "leads"."leads"."reviewed_by_admin_id" IS 'model field: reviewedByAdminId';
COMMENT ON COLUMN "leads"."leads"."reviewed_by_admin_name" IS 'model field: reviewedByAdminName';
COMMENT ON COLUMN "leads"."leads"."reviewed_at" IS 'model field: reviewedAt';
COMMENT ON COLUMN "leads"."leads"."review_note" IS 'model field: reviewNote';
COMMENT ON COLUMN "leads"."leads"."created_at" IS 'model field: createdAt';
COMMENT ON COLUMN "leads"."leads"."updated_at" IS 'model field: updatedAt';
COMMENT ON COLUMN "leads"."leads"."version" IS 'model field: __v';
ALTER TABLE "leads"."leads" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "leads_extra_e02141ac" ON "leads"."leads" USING gin ("_extra") WHERE "_extra" IS NOT NULL;
CREATE INDEX "leads_ix_e5b8dfb3" ON "leads"."leads" USING btree ("name");
CREATE INDEX "leads_ix_82110f0b" ON "leads"."leads" USING btree (("location" #> '{city}'));
CREATE INDEX "leads_ix_37302073" ON "leads"."leads" USING btree (("location" #> '{district}'));
CREATE INDEX "leads_ix_949d701f" ON "leads"."leads" USING btree ("interest");
CREATE INDEX "leads_ix_20b3ed65" ON "leads"."leads" USING btree ("status");
CREATE INDEX "leads_ix_def3150b" ON "leads"."leads" USING btree ("captured_by");
CREATE INDEX "leads_ix_2a65dd95" ON "leads"."leads" USING btree ("assigned_agent_id");
CREATE INDEX "leads_ix_8ec219c0" ON "leads"."leads" USING btree ("field_verified");
CREATE INDEX "leads_ix_82abfc2f" ON "leads"."leads" USING btree ("status", "created_at" DESC NULLS LAST);
CREATE INDEX "leads_ix_b70f11ff" ON "leads"."leads" USING btree ("captured_by", "created_at" DESC NULLS LAST);
CREATE INDEX "leads_ix_5096687e" ON "leads"."leads" USING btree (("meeting" #> '{requested}'), "created_at" DESC NULLS LAST);
CREATE INDEX "leads_ix_761dcb68" ON "leads"."leads" USING btree (("location" #> '{city}'), "status");
CREATE INDEX "leads_ix_18c912c0" ON "leads"."leads" USING btree (("location" #> '{district}'), "status");

REVOKE ALL ON "leads"."leads" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."leads" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."admin_users" (
  "id" text COLLATE "C" PRIMARY KEY,
  "name" text COLLATE "C",
  "email" text COLLATE "C",
  "password_hash" text COLLATE "C",
  "role" text COLLATE "C",
  "status" text COLLATE "C",
  "token_version" double precision,
  "last_login_at" timestamptz,
  "created_at" timestamptz,
  "updated_at" timestamptz,
  "_nulls" text[],
  "_extra" jsonb
);
COMMENT ON TABLE "leads"."admin_users" IS 'Model collection admin_users. Layout: src/database/pg/registry.generated.ts';
COMMENT ON COLUMN "leads"."admin_users"."password_hash" IS 'model field: passwordHash';
COMMENT ON COLUMN "leads"."admin_users"."token_version" IS 'model field: tokenVersion';
COMMENT ON COLUMN "leads"."admin_users"."last_login_at" IS 'model field: lastLoginAt';
COMMENT ON COLUMN "leads"."admin_users"."created_at" IS 'model field: createdAt';
COMMENT ON COLUMN "leads"."admin_users"."updated_at" IS 'model field: updatedAt';
ALTER TABLE "leads"."admin_users" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "admin_users_extra_d7320b5d" ON "leads"."admin_users" USING gin ("_extra") WHERE "_extra" IS NOT NULL;
CREATE UNIQUE INDEX "admin_users_uq_dc50223a" ON "leads"."admin_users" USING btree ("email") NULLS NOT DISTINCT;

REVOKE ALL ON "leads"."admin_users" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."admin_users" FROM %s', r); END IF; END LOOP; END $$;

COMMIT;
