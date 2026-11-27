-- Eco Sor part 6 of 6: notifications, WhatsApp log, audit log, settings.
CREATE TABLE "leads"."notifications" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "user_id" text COLLATE "C" NOT NULL REFERENCES "leads"."lead_users"("id"),
  "event" text COLLATE "C" NOT NULL,
  "title" text COLLATE "C" NOT NULL,
  "body" text COLLATE "C" NOT NULL DEFAULT '',
  "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "channel" text COLLATE "C" NOT NULL DEFAULT 'in_app',
  "is_read" boolean NOT NULL DEFAULT false,
  "read_at" timestamptz,
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "notifications_1_chk" CHECK (jsonb_typeof("data") = 'object'),
  CONSTRAINT "notifications_2_chk" CHECK ("channel" IN ('in_app', 'push'))
);
COMMENT ON TABLE "leads"."notifications" IS 'In-app and push notifications for a user.';
ALTER TABLE "leads"."notifications" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "notifications__set_updated_at" BEFORE UPDATE ON "leads"."notifications" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE INDEX "notifications_user_id_is_read_created_at_idx" ON "leads"."notifications" USING btree ("user_id", "is_read", "created_at" DESC);
CREATE INDEX "notifications_company_id_idx" ON "leads"."notifications" USING btree ("company_id");
REVOKE ALL ON "leads"."notifications" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."notifications" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."whatsapp_logs" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "event" text COLLATE "C" NOT NULL,
  "recipient" text COLLATE "C" NOT NULL,
  "template" text COLLATE "C" NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text COLLATE "C" NOT NULL DEFAULT 'queued',
  "provider_msg_id" text COLLATE "C",
  "retries" double precision NOT NULL DEFAULT 0,
  "error" text COLLATE "C",
  "entity" text COLLATE "C",
  "entity_id" text COLLATE "C",
  "next_retry_at" timestamptz,
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "whatsapp_logs_1_chk" CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "whatsapp_logs_2_chk" CHECK ("status" IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  CONSTRAINT "whatsapp_logs_3_chk" CHECK ("retries" = trunc("retries")),
  CONSTRAINT "whatsapp_logs_4_chk" CHECK ("retries" >= 0)
);
COMMENT ON TABLE "leads"."whatsapp_logs" IS 'Every WhatsApp message attempt (template, recipient, delivery status, retries, error). Never put an OTP in payload.';
ALTER TABLE "leads"."whatsapp_logs" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "whatsapp_logs__set_updated_at" BEFORE UPDATE ON "leads"."whatsapp_logs" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE INDEX "whatsapp_logs_provider_msg_id_idx" ON "leads"."whatsapp_logs" USING btree ("provider_msg_id") WHERE "provider_msg_id" IS NOT NULL;
CREATE INDEX "whatsapp_logs_status_next_retry_at_idx" ON "leads"."whatsapp_logs" USING btree ("status", "next_retry_at");
CREATE INDEX "whatsapp_logs_entity_entity_id_idx" ON "leads"."whatsapp_logs" USING btree ("entity", "entity_id");
CREATE INDEX "whatsapp_logs_company_id_idx" ON "leads"."whatsapp_logs" USING btree ("company_id");
REVOKE ALL ON "leads"."whatsapp_logs" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."whatsapp_logs" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."audit_logs" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "actor_id" text COLLATE "C",
  "actor_role" text COLLATE "C",
  "action" text COLLATE "C" NOT NULL,
  "entity" text COLLATE "C" NOT NULL,
  "entity_id" text COLLATE "C",
  "old_values" jsonb,
  "new_values" jsonb,
  "reason" text COLLATE "C",
  "ip" text COLLATE "C",
  "at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb
);
COMMENT ON TABLE "leads"."audit_logs" IS 'Append-only audit trail: who did what to which record, with old/new values and reason. UPDATE, DELETE and TRUNCATE are blocked.';
ALTER TABLE "leads"."audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "audit_logs_company_id_entity_entity_id_at_idx" ON "leads"."audit_logs" USING btree ("company_id", "entity", "entity_id", "at" DESC);
CREATE INDEX "audit_logs_company_id_actor_id_at_idx" ON "leads"."audit_logs" USING btree ("company_id", "actor_id", "at" DESC);
CREATE INDEX "audit_logs_company_id_action_at_idx" ON "leads"."audit_logs" USING btree ("company_id", "action", "at" DESC);
CREATE INDEX "audit_logs_at_idx" ON "leads"."audit_logs" USING btree ("at");
CREATE TRIGGER "audit_logs__append_only" BEFORE UPDATE OR DELETE ON "leads"."audit_logs" FOR EACH ROW EXECUTE FUNCTION "leads".forbid_change();
CREATE TRIGGER "audit_logs__no_truncate" BEFORE TRUNCATE ON "leads"."audit_logs" FOR EACH STATEMENT EXECUTE FUNCTION "leads".forbid_change();
REVOKE ALL ON "leads"."audit_logs" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."audit_logs" FROM %s', r); END IF; END LOOP; END $$;
-- append-only: UPDATE/DELETE/TRUNCATE are also blocked by the triggers above (they apply to the table owner too).

CREATE TABLE "leads"."system_settings" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "key" text COLLATE "C" NOT NULL,
  "value" jsonb NOT NULL,
  "description" text COLLATE "C",
  "updated_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "system_settings_1_chk" CHECK ("key" ~ '^[a-z][a-z0-9_.]*$')
);
COMMENT ON TABLE "leads"."system_settings" IS 'Per-company key/value settings (policies, limits, template names).';
ALTER TABLE "leads"."system_settings" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "system_settings__set_updated_at" BEFORE UPDATE ON "leads"."system_settings" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "system_settings_company_id_key_key" ON "leads"."system_settings" USING btree ("company_id", "key");
CREATE INDEX "system_settings_updated_by_idx" ON "leads"."system_settings" USING btree ("updated_by");
REVOKE ALL ON "leads"."system_settings" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."system_settings" FROM %s', r); END IF; END LOOP; END $$;

