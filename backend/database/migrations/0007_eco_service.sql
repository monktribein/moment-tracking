-- Eco Sor part 4 of 6: customers, products they own, complaints, field service, closure OTP.
CREATE TABLE "leads"."customers" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "name" text COLLATE "C" NOT NULL,
  "mobile" text COLLATE "C" NOT NULL,
  "mobile_verified" boolean NOT NULL DEFAULT false,
  "email" text COLLATE "C",
  "address" text COLLATE "C",
  "city" text COLLATE "C",
  "state" text COLLATE "C",
  "pin" text COLLATE "C",
  "user_id" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "customers_1_chk" CHECK ("pin" IS NULL OR "pin" ~ '^[0-9]{6}$')
);
COMMENT ON TABLE "leads"."customers" IS 'End customers who use the customer app. mobile is OTP-verified before the account is trusted; user_id is the app login.';
ALTER TABLE "leads"."customers" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "customers__set_updated_at" BEFORE UPDATE ON "leads"."customers" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "customers_company_id_mobile_key" ON "leads"."customers" USING btree ("company_id", "mobile");
CREATE UNIQUE INDEX "customers_user_id_key" ON "leads"."customers" USING btree ("user_id") WHERE "user_id" IS NOT NULL;
CREATE INDEX "customers_company_id_name_idx" ON "leads"."customers" USING btree ("company_id", "name");
CREATE INDEX "customers_user_id_idx" ON "leads"."customers" USING btree ("user_id");
REVOKE ALL ON "leads"."customers" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."customers" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."customer_products" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "customer_id" text COLLATE "C" NOT NULL REFERENCES "leads"."customers"("id"),
  "category" text COLLATE "C" NOT NULL,
  "model" text COLLATE "C" NOT NULL,
  "serial_no" text COLLATE "C" NOT NULL,
  "purchase_date" text COLLATE "C",
  "distributor_id" text COLLATE "C" REFERENCES "leads"."distributors"("id"),
  "proof_key" text COLLATE "C",
  "warranty_status" text COLLATE "C" NOT NULL DEFAULT 'pending',
  "warranty_reviewed_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "warranty_reviewed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "customer_products_1_chk" CHECK ("category" IN ('inverter', 'battery')),
  CONSTRAINT "customer_products_2_chk" CHECK ("purchase_date" ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT "customer_products_3_chk" CHECK ("warranty_status" IN ('pending', 'eligible', 'not_eligible'))
);
COMMENT ON TABLE "leads"."customer_products" IS 'Inverters and batteries a customer has registered. warranty_status is set by a manual review of the purchase proof.';
ALTER TABLE "leads"."customer_products" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "customer_products__set_updated_at" BEFORE UPDATE ON "leads"."customer_products" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "customer_products_company_id_model_serial_no_key" ON "leads"."customer_products" USING btree ("company_id", "model", "serial_no");
CREATE INDEX "customer_products_customer_id_idx" ON "leads"."customer_products" USING btree ("customer_id");
CREATE INDEX "customer_products_purchase_date_idx" ON "leads"."customer_products" USING btree ("purchase_date");
CREATE INDEX "customer_products_distributor_id_idx" ON "leads"."customer_products" USING btree ("distributor_id");
CREATE INDEX "customer_products_warranty_status_idx" ON "leads"."customer_products" USING btree ("warranty_status");
CREATE INDEX "customer_products_warranty_reviewed_by_idx" ON "leads"."customer_products" USING btree ("warranty_reviewed_by");
REVOKE ALL ON "leads"."customer_products" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."customer_products" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."complaints" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "complaint_no" text COLLATE "C" NOT NULL,
  "customer_id" text COLLATE "C" NOT NULL REFERENCES "leads"."customers"("id"),
  "customer_product_id" text COLLATE "C" NOT NULL REFERENCES "leads"."customer_products"("id"),
  "category" text COLLATE "C" NOT NULL,
  "description" text COLLATE "C" NOT NULL,
  "photos" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "warranty_proof_key" text COLLATE "C",
  "service_address" text COLLATE "C" NOT NULL,
  "contact" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL DEFAULT 'open',
  "reopen_count" double precision NOT NULL DEFAULT 0,
  "resolved_at" timestamptz,
  "closed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "complaints_1_chk" CHECK ("status" <> 'closed' OR "closed_at" IS NOT NULL),
  CONSTRAINT "complaints_2_chk" CHECK ("complaint_no" ~ '^CMP-\d{4}-\d{6}$'),
  CONSTRAINT "complaints_3_chk" CHECK ("category" IN ('inverter_not_working', 'inverter_error_code', 'inverter_power_or_charging', 'battery_not_charging', 'battery_low_backup', 'battery_discharge_or_not_working', 'other_inverter_battery')),
  CONSTRAINT "complaints_4_chk" CHECK (jsonb_typeof("photos") = 'array'),
  CONSTRAINT "complaints_5_chk" CHECK ("status" IN ('open', 'assigned', 'in_progress', 'pending', 'resolved', 'closed', 'reopened')),
  CONSTRAINT "complaints_6_chk" CHECK ("reopen_count" = trunc("reopen_count")),
  CONSTRAINT "complaints_7_chk" CHECK ("reopen_count" >= 0)
);
COMMENT ON TABLE "leads"."complaints" IS 'Customer complaints about a registered product. complaint_no is the human ID (CMP-2026-000001); closure needs a verified OTP (see otp_verifications).';
ALTER TABLE "leads"."complaints" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "complaints__set_updated_at" BEFORE UPDATE ON "leads"."complaints" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "complaints_company_id_complaint_no_key" ON "leads"."complaints" USING btree ("company_id", "complaint_no");
CREATE INDEX "complaints_company_id_status_created_at_idx" ON "leads"."complaints" USING btree ("company_id", "status", "created_at" DESC);
CREATE INDEX "complaints_customer_id_created_at_idx" ON "leads"."complaints" USING btree ("customer_id", "created_at" DESC);
CREATE INDEX "complaints_customer_product_id_idx" ON "leads"."complaints" USING btree ("customer_product_id");
CREATE INDEX "complaints_status_idx" ON "leads"."complaints" USING btree ("status");
REVOKE ALL ON "leads"."complaints" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."complaints" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."complaint_assignments" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "complaint_id" text COLLATE "C" NOT NULL REFERENCES "leads"."complaints"("id"),
  "engineer_id" text COLLATE "C" NOT NULL REFERENCES "leads"."employees"("id"),
  "assigned_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "assigned_at" timestamptz NOT NULL DEFAULT now(),
  "scheduled_date" text COLLATE "C",
  "is_current" boolean NOT NULL DEFAULT true,
  "unassigned_at" timestamptz,
  "reason" text COLLATE "C",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "complaint_assignments_1_chk" CHECK ("scheduled_date" ~ '^\d{4}-\d{2}-\d{2}$')
);
COMMENT ON TABLE "leads"."complaint_assignments" IS 'Which engineer a complaint is assigned to; reassignment closes the current row (is_current false) and adds a new one.';
ALTER TABLE "leads"."complaint_assignments" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "complaint_assignments__set_updated_at" BEFORE UPDATE ON "leads"."complaint_assignments" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "complaint_assignments_complaint_id_key" ON "leads"."complaint_assignments" USING btree ("complaint_id") WHERE "is_current";
CREATE INDEX "complaint_assignments_engineer_id_is_current_idx" ON "leads"."complaint_assignments" USING btree ("engineer_id", "is_current");
CREATE INDEX "complaint_assignments_company_id_idx" ON "leads"."complaint_assignments" USING btree ("company_id");
CREATE INDEX "complaint_assignments_complaint_id_idx" ON "leads"."complaint_assignments" USING btree ("complaint_id");
CREATE INDEX "complaint_assignments_assigned_by_idx" ON "leads"."complaint_assignments" USING btree ("assigned_by");
CREATE INDEX "complaint_assignments_scheduled_date_idx" ON "leads"."complaint_assignments" USING btree ("scheduled_date");
REVOKE ALL ON "leads"."complaint_assignments" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."complaint_assignments" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."service_visits" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "complaint_id" text COLLATE "C" NOT NULL REFERENCES "leads"."complaints"("id"),
  "assignment_id" text COLLATE "C" REFERENCES "leads"."complaint_assignments"("id"),
  "engineer_id" text COLLATE "C" NOT NULL REFERENCES "leads"."employees"("id"),
  "scheduled_date" text COLLATE "C",
  "status" text COLLATE "C" NOT NULL DEFAULT 'scheduled',
  "checkin_lat" double precision,
  "checkin_lng" double precision,
  "checkin_accuracy" double precision,
  "checkin_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "service_visits_1_chk" CHECK (("checkin_lat" IS NULL) = ("checkin_lng" IS NULL)),
  CONSTRAINT "service_visits_2_chk" CHECK ("status" NOT IN ('checked_in','completed') OR "checkin_at" IS NOT NULL),
  CONSTRAINT "service_visits_3_chk" CHECK ("scheduled_date" ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT "service_visits_4_chk" CHECK ("status" IN ('scheduled', 'checked_in', 'completed', 'cancelled')),
  CONSTRAINT "service_visits_5_chk" CHECK ("checkin_lat" >= -90),
  CONSTRAINT "service_visits_6_chk" CHECK ("checkin_lat" <= 90),
  CONSTRAINT "service_visits_7_chk" CHECK ("checkin_lng" >= -180),
  CONSTRAINT "service_visits_8_chk" CHECK ("checkin_lng" <= 180),
  CONSTRAINT "service_visits_9_chk" CHECK ("checkin_accuracy" >= 0)
);
COMMENT ON TABLE "leads"."service_visits" IS 'An engineer''s on-site visit for a complaint, with the GPS check-in captured at arrival.';
ALTER TABLE "leads"."service_visits" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "service_visits__set_updated_at" BEFORE UPDATE ON "leads"."service_visits" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE INDEX "service_visits_engineer_id_scheduled_date_idx" ON "leads"."service_visits" USING btree ("engineer_id", "scheduled_date");
CREATE INDEX "service_visits_company_id_idx" ON "leads"."service_visits" USING btree ("company_id");
CREATE INDEX "service_visits_complaint_id_idx" ON "leads"."service_visits" USING btree ("complaint_id");
CREATE INDEX "service_visits_assignment_id_idx" ON "leads"."service_visits" USING btree ("assignment_id");
CREATE INDEX "service_visits_scheduled_date_idx" ON "leads"."service_visits" USING btree ("scheduled_date");
CREATE INDEX "service_visits_status_idx" ON "leads"."service_visits" USING btree ("status");
REVOKE ALL ON "leads"."service_visits" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."service_visits" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."service_reports" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "complaint_id" text COLLATE "C" NOT NULL REFERENCES "leads"."complaints"("id"),
  "visit_id" text COLLATE "C" REFERENCES "leads"."service_visits"("id"),
  "engineer_id" text COLLATE "C" NOT NULL REFERENCES "leads"."employees"("id"),
  "diagnosis" text COLLATE "C" NOT NULL,
  "action_taken" text COLLATE "C" NOT NULL,
  "notes" text COLLATE "C",
  "transcript_lang" text COLLATE "C",
  "photos" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "further_action" text COLLATE "C",
  "submitted_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "service_reports_1_chk" CHECK ("transcript_lang" IN ('en', 'hi', 'hi-en')),
  CONSTRAINT "service_reports_2_chk" CHECK (jsonb_typeof("photos") = 'array')
);
COMMENT ON TABLE "leads"."service_reports" IS 'Engineer''s report after a visit: diagnosis, action taken, notes (typed or voice-to-text), photos and any further action required.';
ALTER TABLE "leads"."service_reports" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "service_reports__set_updated_at" BEFORE UPDATE ON "leads"."service_reports" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE INDEX "service_reports_complaint_id_submitted_at_idx" ON "leads"."service_reports" USING btree ("complaint_id", "submitted_at" DESC);
CREATE INDEX "service_reports_company_id_idx" ON "leads"."service_reports" USING btree ("company_id");
CREATE INDEX "service_reports_visit_id_idx" ON "leads"."service_reports" USING btree ("visit_id");
CREATE INDEX "service_reports_engineer_id_idx" ON "leads"."service_reports" USING btree ("engineer_id");
REVOKE ALL ON "leads"."service_reports" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."service_reports" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."complaint_status_logs" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "complaint_id" text COLLATE "C" NOT NULL REFERENCES "leads"."complaints"("id"),
  "from_status" text COLLATE "C",
  "to_status" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "reason" text COLLATE "C",
  "at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "complaint_status_logs_1_chk" CHECK ("from_status" IN ('open', 'assigned', 'in_progress', 'pending', 'resolved', 'closed', 'reopened')),
  CONSTRAINT "complaint_status_logs_2_chk" CHECK ("to_status" IN ('open', 'assigned', 'in_progress', 'pending', 'resolved', 'closed', 'reopened'))
);
COMMENT ON TABLE "leads"."complaint_status_logs" IS 'Append-only history of every complaint status change, including who closed or reopened it.';
ALTER TABLE "leads"."complaint_status_logs" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "complaint_status_logs_complaint_id_at_idx" ON "leads"."complaint_status_logs" USING btree ("complaint_id", "at");
CREATE INDEX "complaint_status_logs_company_id_idx" ON "leads"."complaint_status_logs" USING btree ("company_id");
CREATE INDEX "complaint_status_logs_from_status_idx" ON "leads"."complaint_status_logs" USING btree ("from_status");
CREATE INDEX "complaint_status_logs_to_status_idx" ON "leads"."complaint_status_logs" USING btree ("to_status");
CREATE INDEX "complaint_status_logs_actor_id_idx" ON "leads"."complaint_status_logs" USING btree ("actor_id");
CREATE INDEX "complaint_status_logs_at_idx" ON "leads"."complaint_status_logs" USING btree ("at");
CREATE TRIGGER "complaint_status_logs__append_only" BEFORE UPDATE OR DELETE ON "leads"."complaint_status_logs" FOR EACH ROW EXECUTE FUNCTION "leads".forbid_change();
CREATE TRIGGER "complaint_status_logs__no_truncate" BEFORE TRUNCATE ON "leads"."complaint_status_logs" FOR EACH STATEMENT EXECUTE FUNCTION "leads".forbid_change();
REVOKE ALL ON "leads"."complaint_status_logs" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."complaint_status_logs" FROM %s', r); END IF; END LOOP; END $$;
-- append-only: UPDATE/DELETE/TRUNCATE are also blocked by the triggers above (they apply to the table owner too).

CREATE TABLE "leads"."otp_verifications" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "complaint_id" text COLLATE "C" NOT NULL REFERENCES "leads"."complaints"("id"),
  "otp_hash" text COLLATE "C" NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "attempts" double precision NOT NULL DEFAULT 0,
  "max_attempts" double precision NOT NULL DEFAULT 5,
  "sent_count" double precision NOT NULL DEFAULT 1,
  "last_sent_at" timestamptz NOT NULL DEFAULT now(),
  "verified_at" timestamptz,
  "invalidated_at" timestamptz,
  "delivery_status" text COLLATE "C" NOT NULL DEFAULT 'pending',
  "requested_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "otp_verifications_1_chk" CHECK ("attempts" <= "max_attempts"),
  CONSTRAINT "otp_verifications_2_chk" CHECK ("verified_at" IS NULL OR "delivery_status" IN ('sent','delivered')),
  CONSTRAINT "otp_verifications_3_chk" CHECK (length("otp_hash") >= 32),
  CONSTRAINT "otp_verifications_4_chk" CHECK ("attempts" = trunc("attempts")),
  CONSTRAINT "otp_verifications_5_chk" CHECK ("attempts" >= 0),
  CONSTRAINT "otp_verifications_6_chk" CHECK ("max_attempts" = trunc("max_attempts")),
  CONSTRAINT "otp_verifications_7_chk" CHECK ("max_attempts" >= 1),
  CONSTRAINT "otp_verifications_8_chk" CHECK ("sent_count" = trunc("sent_count")),
  CONSTRAINT "otp_verifications_9_chk" CHECK ("sent_count" >= 1),
  CONSTRAINT "otp_verifications_10_chk" CHECK ("delivery_status" IN ('pending', 'sent', 'delivered', 'failed'))
);
COMMENT ON TABLE "leads"."otp_verifications" IS 'Single-use service-closure OTPs. Only a hash is stored (never the OTP). Expiry, attempt limit and send count are enforced; at most one live OTP per complaint.';
ALTER TABLE "leads"."otp_verifications" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "otp_verifications__set_updated_at" BEFORE UPDATE ON "leads"."otp_verifications" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "otp_verifications_complaint_id_key" ON "leads"."otp_verifications" USING btree ("complaint_id") WHERE "verified_at" IS NULL AND "invalidated_at" IS NULL;
CREATE INDEX "otp_verifications_expires_at_idx" ON "leads"."otp_verifications" USING btree ("expires_at");
CREATE INDEX "otp_verifications_company_id_idx" ON "leads"."otp_verifications" USING btree ("company_id");
CREATE INDEX "otp_verifications_complaint_id_idx" ON "leads"."otp_verifications" USING btree ("complaint_id");
CREATE INDEX "otp_verifications_delivery_status_idx" ON "leads"."otp_verifications" USING btree ("delivery_status");
CREATE INDEX "otp_verifications_requested_by_idx" ON "leads"."otp_verifications" USING btree ("requested_by");
REVOKE ALL ON "leads"."otp_verifications" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."otp_verifications" FROM %s', r); END IF; END LOOP; END $$;

