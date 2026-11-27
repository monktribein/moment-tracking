-- Eco Sor part 3 of 6: purchase request engine (requests, items, versions, payments, proofs, logs).
CREATE TABLE "leads"."purchase_requests" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "request_no" text COLLATE "C" NOT NULL,
  "distributor_id" text COLLATE "C" NOT NULL REFERENCES "leads"."distributors"("id"),
  "source" text COLLATE "C" NOT NULL,
  "creator_user_id" text COLLATE "C" NOT NULL REFERENCES "leads"."lead_users"("id"),
  "status" text COLLATE "C" NOT NULL DEFAULT 'draft',
  "payment_status" text COLLATE "C" NOT NULL DEFAULT 'pending',
  "remarks" text COLLATE "C",
  "external_invoice_ref" text COLLATE "C",
  "version" double precision NOT NULL DEFAULT 1,
  "idempotency_key" text COLLATE "C",
  "submitted_at" timestamptz,
  "approved_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "approved_at" timestamptz,
  "processed_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "processed_at" timestamptz,
  "rejection_reason" text COLLATE "C",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "purchase_requests_1_chk" CHECK ("status" NOT IN ('approved','processed') OR "payment_status" = 'verified'),
  CONSTRAINT "purchase_requests_2_chk" CHECK ("status" NOT IN ('approved','processed') OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL)),
  CONSTRAINT "purchase_requests_3_chk" CHECK ("status" <> 'processed' OR "processed_at" IS NOT NULL),
  CONSTRAINT "purchase_requests_4_chk" CHECK ("status" <> 'rejected' OR coalesce("rejection_reason", '') <> ''),
  CONSTRAINT "purchase_requests_5_chk" CHECK ("idempotency_key" IS NULL OR length("idempotency_key") BETWEEN 8 AND 128),
  CONSTRAINT "purchase_requests_6_chk" CHECK ("request_no" ~ '^PR-\d{4}-\d{6}$'),
  CONSTRAINT "purchase_requests_7_chk" CHECK ("source" IN ('web', 'android', 'portal')),
  CONSTRAINT "purchase_requests_8_chk" CHECK ("status" IN ('draft', 'submitted', 'under_review', 'correction_required', 'approved', 'rejected', 'cancelled', 'processed')),
  CONSTRAINT "purchase_requests_9_chk" CHECK ("payment_status" IN ('pending', 'verified', 'rejected')),
  CONSTRAINT "purchase_requests_10_chk" CHECK ("version" = trunc("version")),
  CONSTRAINT "purchase_requests_11_chk" CHECK ("version" >= 1)
);
COMMENT ON TABLE "leads"."purchase_requests" IS 'Distributor purchase requests (web, Android or portal). request_no is the human ID; version counts corrections; idempotency_key stops double submits. Approval requires a verified payment (enforced by a CHECK).';
ALTER TABLE "leads"."purchase_requests" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "purchase_requests__set_updated_at" BEFORE UPDATE ON "leads"."purchase_requests" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "purchase_requests_company_id_request_no_key" ON "leads"."purchase_requests" USING btree ("company_id", "request_no");
CREATE UNIQUE INDEX "purchase_requests_company_id_idempotency_key_key" ON "leads"."purchase_requests" USING btree ("company_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX "purchase_requests_company_id_status_created_at_idx" ON "leads"."purchase_requests" USING btree ("company_id", "status", "created_at" DESC);
CREATE INDEX "purchase_requests_distributor_id_created_at_idx" ON "leads"."purchase_requests" USING btree ("distributor_id", "created_at" DESC);
CREATE INDEX "purchase_requests_company_id_payment_status_idx" ON "leads"."purchase_requests" USING btree ("company_id", "payment_status");
CREATE INDEX "purchase_requests_creator_user_id_idx" ON "leads"."purchase_requests" USING btree ("creator_user_id");
CREATE INDEX "purchase_requests_status_idx" ON "leads"."purchase_requests" USING btree ("status");
CREATE INDEX "purchase_requests_payment_status_idx" ON "leads"."purchase_requests" USING btree ("payment_status");
CREATE INDEX "purchase_requests_approved_by_idx" ON "leads"."purchase_requests" USING btree ("approved_by");
CREATE INDEX "purchase_requests_processed_by_idx" ON "leads"."purchase_requests" USING btree ("processed_by");
REVOKE ALL ON "leads"."purchase_requests" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."purchase_requests" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."purchase_request_items" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "request_id" text COLLATE "C" NOT NULL REFERENCES "leads"."purchase_requests"("id") ON DELETE CASCADE,
  "product_id" text COLLATE "C" NOT NULL REFERENCES "leads"."products"("id"),
  "product_snapshot" jsonb NOT NULL,
  "quantity" double precision NOT NULL,
  "remarks" text COLLATE "C",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "purchase_request_items_1_chk" CHECK (jsonb_typeof("product_snapshot") = 'object'),
  CONSTRAINT "purchase_request_items_2_chk" CHECK ("product_snapshot" ?& ARRAY['name','model','sku']),
  CONSTRAINT "purchase_request_items_3_chk" CHECK ("quantity" = trunc("quantity")),
  CONSTRAINT "purchase_request_items_4_chk" CHECK ("quantity" > 0)
);
COMMENT ON TABLE "leads"."purchase_request_items" IS 'Line items of a purchase request. product_snapshot freezes name/model/sku at request time; quantity is a positive whole number.';
ALTER TABLE "leads"."purchase_request_items" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "purchase_request_items__set_updated_at" BEFORE UPDATE ON "leads"."purchase_request_items" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "purchase_request_items_request_id_product_id_key" ON "leads"."purchase_request_items" USING btree ("request_id", "product_id");
CREATE INDEX "purchase_request_items_product_id_idx" ON "leads"."purchase_request_items" USING btree ("product_id");
CREATE INDEX "purchase_request_items_company_id_idx" ON "leads"."purchase_request_items" USING btree ("company_id");
REVOKE ALL ON "leads"."purchase_request_items" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."purchase_request_items" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."purchase_request_versions" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "request_id" text COLLATE "C" NOT NULL REFERENCES "leads"."purchase_requests"("id") ON DELETE CASCADE,
  "version" double precision NOT NULL,
  "snapshot" jsonb NOT NULL,
  "changed_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "reason" text COLLATE "C",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "purchase_request_versions_1_chk" CHECK ("version" = trunc("version")),
  CONSTRAINT "purchase_request_versions_2_chk" CHECK ("version" >= 1),
  CONSTRAINT "purchase_request_versions_3_chk" CHECK (jsonb_typeof("snapshot") = 'object')
);
COMMENT ON TABLE "leads"."purchase_request_versions" IS 'Full snapshot of a request (header, items, payment) each time it is corrected, so earlier submissions are never lost.';
ALTER TABLE "leads"."purchase_request_versions" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "purchase_request_versions__set_updated_at" BEFORE UPDATE ON "leads"."purchase_request_versions" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "purchase_request_versions_request_id_version_key" ON "leads"."purchase_request_versions" USING btree ("request_id", "version");
CREATE INDEX "purchase_request_versions_company_id_idx" ON "leads"."purchase_request_versions" USING btree ("company_id");
CREATE INDEX "purchase_request_versions_changed_by_idx" ON "leads"."purchase_request_versions" USING btree ("changed_by");
REVOKE ALL ON "leads"."purchase_request_versions" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."purchase_request_versions" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."purchase_payments" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "request_id" text COLLATE "C" NOT NULL REFERENCES "leads"."purchase_requests"("id"),
  "amount" double precision NOT NULL,
  "method" text COLLATE "C" NOT NULL,
  "payment_date" text COLLATE "C" NOT NULL,
  "utr_raw" text COLLATE "C" NOT NULL,
  "utr_normalized" text COLLATE "C" NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "status" text COLLATE "C" NOT NULL DEFAULT 'pending',
  "submitted_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "reviewer_id" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "reviewed_at" timestamptz,
  "rejection_reason" text COLLATE "C",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "purchase_payments_1_chk" CHECK ("status" = 'pending' OR ("reviewer_id" IS NOT NULL AND "reviewed_at" IS NOT NULL)),
  CONSTRAINT "purchase_payments_2_chk" CHECK ("status" <> 'rejected' OR coalesce(btrim("rejection_reason"), '') <> ''),
  CONSTRAINT "purchase_payments_3_chk" CHECK ("utr_normalized" <> ''),
  CONSTRAINT "purchase_payments_4_chk" CHECK ("amount" > 0),
  CONSTRAINT "purchase_payments_5_chk" CHECK ("amount" > 0),
  CONSTRAINT "purchase_payments_6_chk" CHECK ("payment_date" ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT "purchase_payments_7_chk" CHECK (length(btrim("utr_raw")) > 0),
  CONSTRAINT "purchase_payments_8_chk" CHECK ("status" IN ('pending', 'verified', 'rejected'))
);
COMMENT ON TABLE "leads"."purchase_payments" IS 'Payment submissions for a request. Earlier submissions are kept; only one may be active. A verified UTR can belong to one verified payment per company (no double allocation).';
ALTER TABLE "leads"."purchase_payments" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "purchase_payments__set_updated_at" BEFORE UPDATE ON "leads"."purchase_payments" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "purchase_payments_request_id_key" ON "leads"."purchase_payments" USING btree ("request_id") WHERE "is_active";
CREATE UNIQUE INDEX "purchase_payments_company_id_utr_normalized_key" ON "leads"."purchase_payments" USING btree ("company_id", "utr_normalized") WHERE "status" = 'verified';
CREATE INDEX "purchase_payments_company_id_utr_normalized_idx" ON "leads"."purchase_payments" USING btree ("company_id", "utr_normalized");
CREATE INDEX "purchase_payments_company_id_status_created_at_idx" ON "leads"."purchase_payments" USING btree ("company_id", "status", "created_at" DESC);
CREATE INDEX "purchase_payments_reviewer_id_idx" ON "leads"."purchase_payments" USING btree ("reviewer_id");
CREATE INDEX "purchase_payments_request_id_idx" ON "leads"."purchase_payments" USING btree ("request_id");
CREATE INDEX "purchase_payments_payment_date_idx" ON "leads"."purchase_payments" USING btree ("payment_date");
CREATE INDEX "purchase_payments_status_idx" ON "leads"."purchase_payments" USING btree ("status");
CREATE INDEX "purchase_payments_submitted_by_idx" ON "leads"."purchase_payments" USING btree ("submitted_by");
CREATE OR REPLACE FUNCTION "leads".normalize_utr() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW."utr_normalized" := upper(regexp_replace(coalesce(NEW."utr_raw", ''), '[^A-Za-z0-9]', '', 'g')); RETURN NEW; END $$;
COMMENT ON FUNCTION "leads".normalize_utr() IS 'Derives purchase_payments.utr_normalized (upper-case letters and digits only) from utr_raw.';
CREATE TRIGGER "purchase_payments_normalize_utr" BEFORE INSERT OR UPDATE OF "utr_raw" ON "leads"."purchase_payments" FOR EACH ROW EXECUTE FUNCTION "leads".normalize_utr();
REVOKE ALL ON "leads"."purchase_payments" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."purchase_payments" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."payment_proofs" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "payment_id" text COLLATE "C" NOT NULL REFERENCES "leads"."purchase_payments"("id"),
  "storage_key" text COLLATE "C" NOT NULL,
  "mime" text COLLATE "C" NOT NULL,
  "size_bytes" double precision NOT NULL,
  "sha256" text COLLATE "C",
  "uploaded_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "payment_proofs_1_chk" CHECK ("storage_key" !~* '^https?://'),
  CONSTRAINT "payment_proofs_2_chk" CHECK ("mime" IN ('image/jpeg', 'image/png')),
  CONSTRAINT "payment_proofs_3_chk" CHECK ("size_bytes" = trunc("size_bytes")),
  CONSTRAINT "payment_proofs_4_chk" CHECK ("size_bytes" BETWEEN 1 AND 5242880),
  CONSTRAINT "payment_proofs_5_chk" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$')
);
COMMENT ON TABLE "leads"."payment_proofs" IS 'Payment screenshot metadata. storage_key points into PRIVATE object storage; images are served only through short-lived signed access, never a public URL.';
ALTER TABLE "leads"."payment_proofs" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "payment_proofs__set_updated_at" BEFORE UPDATE ON "leads"."payment_proofs" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "payment_proofs_company_id_storage_key_key" ON "leads"."payment_proofs" USING btree ("company_id", "storage_key");
CREATE INDEX "payment_proofs_company_id_sha256_idx" ON "leads"."payment_proofs" USING btree ("company_id", "sha256") WHERE "sha256" IS NOT NULL;
CREATE INDEX "payment_proofs_payment_id_idx" ON "leads"."payment_proofs" USING btree ("payment_id");
CREATE INDEX "payment_proofs_uploaded_by_idx" ON "leads"."payment_proofs" USING btree ("uploaded_by");
REVOKE ALL ON "leads"."payment_proofs" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."payment_proofs" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."payment_verification_logs" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "payment_id" text COLLATE "C" NOT NULL REFERENCES "leads"."purchase_payments"("id"),
  "request_id" text COLLATE "C" NOT NULL REFERENCES "leads"."purchase_requests"("id"),
  "action" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "utr_normalized" text COLLATE "C",
  "reason" text COLLATE "C",
  "at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "payment_verification_logs_1_chk" CHECK ("action" IN ('submitted', 'verified', 'rejected', 'resubmitted', 'duplicate_flagged'))
);
COMMENT ON TABLE "leads"."payment_verification_logs" IS 'Append-only trail of every payment review step: submitted, verified, rejected, duplicate flagged, resubmitted.';
ALTER TABLE "leads"."payment_verification_logs" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "payment_verification_logs_request_id_at_idx" ON "leads"."payment_verification_logs" USING btree ("request_id", "at");
CREATE INDEX "payment_verification_logs_company_id_idx" ON "leads"."payment_verification_logs" USING btree ("company_id");
CREATE INDEX "payment_verification_logs_payment_id_idx" ON "leads"."payment_verification_logs" USING btree ("payment_id");
CREATE INDEX "payment_verification_logs_actor_id_idx" ON "leads"."payment_verification_logs" USING btree ("actor_id");
CREATE INDEX "payment_verification_logs_at_idx" ON "leads"."payment_verification_logs" USING btree ("at");
CREATE TRIGGER "payment_verification_logs__append_only" BEFORE UPDATE OR DELETE ON "leads"."payment_verification_logs" FOR EACH ROW EXECUTE FUNCTION "leads".forbid_change();
CREATE TRIGGER "payment_verification_logs__no_truncate" BEFORE TRUNCATE ON "leads"."payment_verification_logs" FOR EACH STATEMENT EXECUTE FUNCTION "leads".forbid_change();
REVOKE ALL ON "leads"."payment_verification_logs" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."payment_verification_logs" FROM %s', r); END IF; END LOOP; END $$;
-- append-only: UPDATE/DELETE/TRUNCATE are also blocked by the triggers above (they apply to the table owner too).

CREATE TABLE "leads"."purchase_status_logs" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "request_id" text COLLATE "C" NOT NULL REFERENCES "leads"."purchase_requests"("id"),
  "from_status" text COLLATE "C",
  "to_status" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "reason" text COLLATE "C",
  "at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "purchase_status_logs_1_chk" CHECK ("from_status" IN ('draft', 'submitted', 'under_review', 'correction_required', 'approved', 'rejected', 'cancelled', 'processed')),
  CONSTRAINT "purchase_status_logs_2_chk" CHECK ("to_status" IN ('draft', 'submitted', 'under_review', 'correction_required', 'approved', 'rejected', 'cancelled', 'processed'))
);
COMMENT ON TABLE "leads"."purchase_status_logs" IS 'Append-only history of every purchase request status change: from, to, who and why.';
ALTER TABLE "leads"."purchase_status_logs" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "purchase_status_logs_request_id_at_idx" ON "leads"."purchase_status_logs" USING btree ("request_id", "at");
CREATE INDEX "purchase_status_logs_company_id_idx" ON "leads"."purchase_status_logs" USING btree ("company_id");
CREATE INDEX "purchase_status_logs_from_status_idx" ON "leads"."purchase_status_logs" USING btree ("from_status");
CREATE INDEX "purchase_status_logs_to_status_idx" ON "leads"."purchase_status_logs" USING btree ("to_status");
CREATE INDEX "purchase_status_logs_actor_id_idx" ON "leads"."purchase_status_logs" USING btree ("actor_id");
CREATE INDEX "purchase_status_logs_at_idx" ON "leads"."purchase_status_logs" USING btree ("at");
CREATE TRIGGER "purchase_status_logs__append_only" BEFORE UPDATE OR DELETE ON "leads"."purchase_status_logs" FOR EACH ROW EXECUTE FUNCTION "leads".forbid_change();
CREATE TRIGGER "purchase_status_logs__no_truncate" BEFORE TRUNCATE ON "leads"."purchase_status_logs" FOR EACH STATEMENT EXECUTE FUNCTION "leads".forbid_change();
REVOKE ALL ON "leads"."purchase_status_logs" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."purchase_status_logs" FROM %s', r); END IF; END LOOP; END $$;
-- append-only: UPDATE/DELETE/TRUNCATE are also blocked by the triggers above (they apply to the table owner too).

