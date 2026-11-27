-- Eco Sor part 2 of 6: sales visits, visit reports, call logs, follow-ups.
CREATE TABLE "leads"."sales_visits" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "distributor_id" text COLLATE "C" NOT NULL REFERENCES "leads"."distributors"("id"),
  "employee_id" text COLLATE "C" NOT NULL REFERENCES "leads"."employees"("id"),
  "visit_date" text COLLATE "C" NOT NULL,
  "purpose" text COLLATE "C",
  "priority" text COLLATE "C" NOT NULL DEFAULT 'normal',
  "instructions" text COLLATE "C",
  "status" text COLLATE "C" NOT NULL DEFAULT 'scheduled',
  "checkin_lat" double precision,
  "checkin_lng" double precision,
  "checkin_accuracy" double precision,
  "checkin_at" timestamptz,
  "rescheduled_to_id" text COLLATE "C" REFERENCES "leads"."sales_visits"("id"),
  "cancel_reason" text COLLATE "C",
  "assigned_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "created_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "sales_visits_1_chk" CHECK (("checkin_lat" IS NULL) = ("checkin_lng" IS NULL)),
  CONSTRAINT "sales_visits_2_chk" CHECK ("status" NOT IN ('checked_in','report_submitted') OR ("checkin_at" IS NOT NULL AND "checkin_lat" IS NOT NULL)),
  CONSTRAINT "sales_visits_3_chk" CHECK ("visit_date" ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT "sales_visits_4_chk" CHECK ("priority" IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT "sales_visits_5_chk" CHECK ("status" IN ('scheduled', 'checked_in', 'report_submitted', 'completed', 'cancelled', 'rescheduled')),
  CONSTRAINT "sales_visits_6_chk" CHECK ("checkin_lat" >= -90),
  CONSTRAINT "sales_visits_7_chk" CHECK ("checkin_lat" <= 90),
  CONSTRAINT "sales_visits_8_chk" CHECK ("checkin_lng" >= -180),
  CONSTRAINT "sales_visits_9_chk" CHECK ("checkin_lng" <= 180),
  CONSTRAINT "sales_visits_10_chk" CHECK ("checkin_accuracy" >= 0)
);
COMMENT ON TABLE "leads"."sales_visits" IS 'Distributor visits assigned by a Sales Manager to a field employee, with the GPS check-in captured once at arrival (no continuous tracking).';
ALTER TABLE "leads"."sales_visits" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "sales_visits__set_updated_at" BEFORE UPDATE ON "leads"."sales_visits" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE INDEX "sales_visits_company_id_employee_id_visit_date_idx" ON "leads"."sales_visits" USING btree ("company_id", "employee_id", "visit_date");
CREATE INDEX "sales_visits_distributor_id_visit_date_idx" ON "leads"."sales_visits" USING btree ("distributor_id", "visit_date" DESC);
CREATE INDEX "sales_visits_company_id_status_visit_date_idx" ON "leads"."sales_visits" USING btree ("company_id", "status", "visit_date");
CREATE INDEX "sales_visits_employee_id_idx" ON "leads"."sales_visits" USING btree ("employee_id");
CREATE INDEX "sales_visits_visit_date_idx" ON "leads"."sales_visits" USING btree ("visit_date");
CREATE INDEX "sales_visits_status_idx" ON "leads"."sales_visits" USING btree ("status");
CREATE INDEX "sales_visits_rescheduled_to_id_idx" ON "leads"."sales_visits" USING btree ("rescheduled_to_id");
CREATE INDEX "sales_visits_assigned_by_idx" ON "leads"."sales_visits" USING btree ("assigned_by");
CREATE INDEX "sales_visits_created_by_idx" ON "leads"."sales_visits" USING btree ("created_by");
REVOKE ALL ON "leads"."sales_visits" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."sales_visits" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."visit_reports" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "visit_id" text COLLATE "C" NOT NULL REFERENCES "leads"."sales_visits"("id"),
  "employee_id" text COLLATE "C" NOT NULL REFERENCES "leads"."employees"("id"),
  "notes" text COLLATE "C" NOT NULL,
  "transcript_lang" text COLLATE "C",
  "photos" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "product_requirements" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "next_followup_date" text COLLATE "C",
  "submitted_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "visit_reports_1_chk" CHECK ("transcript_lang" IN ('en', 'hi', 'hi-en')),
  CONSTRAINT "visit_reports_2_chk" CHECK (jsonb_typeof("photos") = 'array'),
  CONSTRAINT "visit_reports_3_chk" CHECK (jsonb_typeof("product_requirements") = 'array'),
  CONSTRAINT "visit_reports_4_chk" CHECK ("next_followup_date" ~ '^\d{4}-\d{2}-\d{2}$')
);
COMMENT ON TABLE "leads"."visit_reports" IS 'Meeting report an employee files for a visit: notes (typed or voice-to-text), photos, product requirements and the next follow-up date. One per visit.';
ALTER TABLE "leads"."visit_reports" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "visit_reports__set_updated_at" BEFORE UPDATE ON "leads"."visit_reports" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "visit_reports_visit_id_key" ON "leads"."visit_reports" USING btree ("visit_id");
CREATE INDEX "visit_reports_employee_id_submitted_at_idx" ON "leads"."visit_reports" USING btree ("employee_id", "submitted_at" DESC);
CREATE INDEX "visit_reports_company_id_idx" ON "leads"."visit_reports" USING btree ("company_id");
CREATE INDEX "visit_reports_next_followup_date_idx" ON "leads"."visit_reports" USING btree ("next_followup_date");
REVOKE ALL ON "leads"."visit_reports" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."visit_reports" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."call_logs" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "distributor_id" text COLLATE "C" NOT NULL REFERENCES "leads"."distributors"("id"),
  "employee_id" text COLLATE "C" NOT NULL REFERENCES "leads"."employees"("id"),
  "direction" text COLLATE "C" NOT NULL,
  "outcome" text COLLATE "C",
  "notes" text COLLATE "C",
  "next_followup_date" text COLLATE "C",
  "called_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "call_logs_1_chk" CHECK ("direction" IN ('in', 'out')),
  CONSTRAINT "call_logs_2_chk" CHECK ("next_followup_date" ~ '^\d{4}-\d{2}-\d{2}$')
);
COMMENT ON TABLE "leads"."call_logs" IS 'Tele-sales incoming/outgoing call records: outcome, discussion notes and next follow-up. No recordings or dialer data.';
ALTER TABLE "leads"."call_logs" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "call_logs__set_updated_at" BEFORE UPDATE ON "leads"."call_logs" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE INDEX "call_logs_company_id_called_at_idx" ON "leads"."call_logs" USING btree ("company_id", "called_at" DESC);
CREATE INDEX "call_logs_distributor_id_called_at_idx" ON "leads"."call_logs" USING btree ("distributor_id", "called_at" DESC);
CREATE INDEX "call_logs_employee_id_called_at_idx" ON "leads"."call_logs" USING btree ("employee_id", "called_at" DESC);
CREATE INDEX "call_logs_next_followup_date_idx" ON "leads"."call_logs" USING btree ("next_followup_date");
REVOKE ALL ON "leads"."call_logs" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."call_logs" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."followups" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "distributor_id" text COLLATE "C" NOT NULL REFERENCES "leads"."distributors"("id"),
  "employee_id" text COLLATE "C" NOT NULL REFERENCES "leads"."employees"("id"),
  "source" text COLLATE "C" NOT NULL,
  "visit_id" text COLLATE "C" REFERENCES "leads"."sales_visits"("id"),
  "call_log_id" text COLLATE "C" REFERENCES "leads"."call_logs"("id"),
  "lead_id" text COLLATE "C" REFERENCES "leads"."leads"("id"),
  "due_date" text COLLATE "C" NOT NULL,
  "status" text COLLATE "C" NOT NULL DEFAULT 'pending',
  "notes" text COLLATE "C",
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "followups_1_chk" CHECK (("source" <> 'visit' OR "visit_id" IS NOT NULL) AND ("source" <> 'call' OR "call_log_id" IS NOT NULL) AND ("source" <> 'lead' OR "lead_id" IS NOT NULL)),
  CONSTRAINT "followups_2_chk" CHECK ("status" <> 'done' OR "completed_at" IS NOT NULL),
  CONSTRAINT "followups_3_chk" CHECK ("source" IN ('visit', 'call', 'lead')),
  CONSTRAINT "followups_4_chk" CHECK ("due_date" ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT "followups_5_chk" CHECK ("status" IN ('pending', 'done', 'cancelled'))
);
COMMENT ON TABLE "leads"."followups" IS 'Follow-ups raised from a visit, a call or a lead. Pending ones feed the sales manager''s overdue list.';
ALTER TABLE "leads"."followups" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "followups__set_updated_at" BEFORE UPDATE ON "leads"."followups" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE INDEX "followups_company_id_employee_id_status_due_date_idx" ON "leads"."followups" USING btree ("company_id", "employee_id", "status", "due_date");
CREATE INDEX "followups_distributor_id_idx" ON "leads"."followups" USING btree ("distributor_id");
CREATE INDEX "followups_employee_id_idx" ON "leads"."followups" USING btree ("employee_id");
CREATE INDEX "followups_visit_id_idx" ON "leads"."followups" USING btree ("visit_id");
CREATE INDEX "followups_call_log_id_idx" ON "leads"."followups" USING btree ("call_log_id");
CREATE INDEX "followups_lead_id_idx" ON "leads"."followups" USING btree ("lead_id");
CREATE INDEX "followups_due_date_idx" ON "leads"."followups" USING btree ("due_date");
CREATE INDEX "followups_status_idx" ON "leads"."followups" USING btree ("status");
REVOKE ALL ON "leads"."followups" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."followups" FROM %s', r); END IF; END LOOP; END $$;

