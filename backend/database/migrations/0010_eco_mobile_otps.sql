-- Eco Sor API support: one-time codes sent to a mobile number (customer registration, password reset).
-- Complaint-closure codes stay in otp_verifications. Only a bcrypt hash is stored, never the code.

CREATE TABLE "leads"."mobile_otps" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "mobile" text COLLATE "C" NOT NULL,
  "purpose" text COLLATE "C" NOT NULL,
  "otp_hash" text COLLATE "C" NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "attempts" double precision NOT NULL DEFAULT 0,
  "max_attempts" double precision NOT NULL DEFAULT 5,
  "verified_at" timestamptz,
  "invalidated_at" timestamptz,
  "delivery_status" text COLLATE "C" NOT NULL DEFAULT 'pending',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "mobile_otps_1_chk" CHECK ("purpose" IN ('register', 'reset_password')),
  CONSTRAINT "mobile_otps_2_chk" CHECK ("mobile" ~ '^[0-9]{10}$'),
  CONSTRAINT "mobile_otps_3_chk" CHECK ("delivery_status" IN ('pending', 'sent', 'delivered', 'failed')),
  CONSTRAINT "mobile_otps_4_chk" CHECK ("attempts" >= 0 AND "attempts" <= "max_attempts"),
  CONSTRAINT "mobile_otps_5_chk" CHECK (length("otp_hash") >= 32)
);
COMMENT ON TABLE "leads"."mobile_otps" IS 'One-time codes sent by WhatsApp to a mobile number for customer registration and password reset. Hash only; expiry, attempt limit and per-hour send limit are enforced by the API.';
ALTER TABLE "leads"."mobile_otps" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "mobile_otps__set_updated_at" BEFORE UPDATE ON "leads"."mobile_otps" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE INDEX "mobile_otps_company_id_idx" ON "leads"."mobile_otps" USING btree ("company_id");
CREATE INDEX "mobile_otps_mobile_purpose_created_at_idx" ON "leads"."mobile_otps" USING btree ("mobile", "purpose", "created_at" DESC);
CREATE UNIQUE INDEX "mobile_otps_mobile_purpose_key" ON "leads"."mobile_otps" USING btree ("mobile", "purpose") WHERE "verified_at" IS NULL AND "invalidated_at" IS NULL;
REVOKE ALL ON "leads"."mobile_otps" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."mobile_otps" FROM %s', r); END IF; END LOOP; END $$;
