-- Eco Sor part 5 of 6: HR. Attendance itself stays in leads.lead_attendances; this adds corrections, expenses, leave, holidays, payroll.
CREATE TABLE "leads"."attendance_corrections" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "attendance_id" text COLLATE "C" NOT NULL REFERENCES "leads"."lead_attendances"("id"),
  "employee_id" text COLLATE "C" REFERENCES "leads"."employees"("id"),
  "old_values" jsonb NOT NULL,
  "new_values" jsonb NOT NULL,
  "reason" text COLLATE "C" NOT NULL,
  "corrected_by" text COLLATE "C" NOT NULL REFERENCES "leads"."lead_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "attendance_corrections_1_chk" CHECK (jsonb_typeof("old_values") = 'object'),
  CONSTRAINT "attendance_corrections_2_chk" CHECK (jsonb_typeof("new_values") = 'object'),
  CONSTRAINT "attendance_corrections_3_chk" CHECK (length(btrim("reason")) > 0)
);
COMMENT ON TABLE "leads"."attendance_corrections" IS 'HR corrections to an existing attendance row (leads.lead_attendances): what changed, why, and who did it. The attendance table itself is unchanged.';
ALTER TABLE "leads"."attendance_corrections" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "attendance_corrections__set_updated_at" BEFORE UPDATE ON "leads"."attendance_corrections" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE INDEX "attendance_corrections_attendance_id_created_at_idx" ON "leads"."attendance_corrections" USING btree ("attendance_id", "created_at" DESC);
CREATE INDEX "attendance_corrections_company_id_idx" ON "leads"."attendance_corrections" USING btree ("company_id");
CREATE INDEX "attendance_corrections_employee_id_idx" ON "leads"."attendance_corrections" USING btree ("employee_id");
CREATE INDEX "attendance_corrections_corrected_by_idx" ON "leads"."attendance_corrections" USING btree ("corrected_by");
REVOKE ALL ON "leads"."attendance_corrections" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."attendance_corrections" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."expenses" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "employee_id" text COLLATE "C" NOT NULL REFERENCES "leads"."employees"("id"),
  "expense_date" text COLLATE "C" NOT NULL,
  "category" text COLLATE "C" NOT NULL,
  "amount" double precision NOT NULL,
  "description" text COLLATE "C",
  "receipt_key" text COLLATE "C",
  "visit_id" text COLLATE "C" REFERENCES "leads"."sales_visits"("id"),
  "status" text COLLATE "C" NOT NULL DEFAULT 'submitted',
  "rejection_reason" text COLLATE "C",
  "reimbursed_at" timestamptz,
  "reimbursement_ref" text COLLATE "C",
  "reimbursed_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "expenses_1_chk" CHECK ("status" <> 'rejected' OR coalesce(btrim("rejection_reason"), '') <> ''),
  CONSTRAINT "expenses_2_chk" CHECK ("status" <> 'reimbursed' OR "reimbursed_at" IS NOT NULL),
  CONSTRAINT "expenses_3_chk" CHECK ("expense_date" ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT "expenses_4_chk" CHECK ("amount" > 0),
  CONSTRAINT "expenses_5_chk" CHECK ("amount" > 0),
  CONSTRAINT "expenses_6_chk" CHECK ("status" IN ('submitted', 'approved', 'rejected', 'reimbursed'))
);
COMMENT ON TABLE "leads"."expenses" IS 'Employee expense claims with an optional receipt and visit. Approval and reimbursement are recorded manually; a rejection needs a reason.';
ALTER TABLE "leads"."expenses" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "expenses__set_updated_at" BEFORE UPDATE ON "leads"."expenses" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE INDEX "expenses_company_id_status_expense_date_idx" ON "leads"."expenses" USING btree ("company_id", "status", "expense_date" DESC);
CREATE INDEX "expenses_employee_id_expense_date_idx" ON "leads"."expenses" USING btree ("employee_id", "expense_date" DESC);
CREATE INDEX "expenses_expense_date_idx" ON "leads"."expenses" USING btree ("expense_date");
CREATE INDEX "expenses_visit_id_idx" ON "leads"."expenses" USING btree ("visit_id");
CREATE INDEX "expenses_status_idx" ON "leads"."expenses" USING btree ("status");
CREATE INDEX "expenses_reimbursed_by_idx" ON "leads"."expenses" USING btree ("reimbursed_by");
REVOKE ALL ON "leads"."expenses" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."expenses" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."expense_approvals" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "expense_id" text COLLATE "C" NOT NULL REFERENCES "leads"."expenses"("id"),
  "action" text COLLATE "C" NOT NULL,
  "actor_id" text COLLATE "C" NOT NULL REFERENCES "leads"."lead_users"("id"),
  "reason" text COLLATE "C",
  "at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "expense_approvals_1_chk" CHECK ("action" <> 'rejected' OR coalesce(btrim("reason"), '') <> ''),
  CONSTRAINT "expense_approvals_2_chk" CHECK ("action" IN ('approved', 'rejected', 'reimbursed'))
);
COMMENT ON TABLE "leads"."expense_approvals" IS 'Append-style log of approve / reject / reimburse actions on an expense.';
ALTER TABLE "leads"."expense_approvals" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "expense_approvals__set_updated_at" BEFORE UPDATE ON "leads"."expense_approvals" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE INDEX "expense_approvals_expense_id_at_idx" ON "leads"."expense_approvals" USING btree ("expense_id", "at");
CREATE INDEX "expense_approvals_company_id_idx" ON "leads"."expense_approvals" USING btree ("company_id");
CREATE INDEX "expense_approvals_actor_id_idx" ON "leads"."expense_approvals" USING btree ("actor_id");
CREATE INDEX "expense_approvals_at_idx" ON "leads"."expense_approvals" USING btree ("at");
REVOKE ALL ON "leads"."expense_approvals" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."expense_approvals" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."leaves" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "employee_id" text COLLATE "C" NOT NULL REFERENCES "leads"."employees"("id"),
  "from_date" text COLLATE "C" NOT NULL,
  "to_date" text COLLATE "C" NOT NULL,
  "leave_type" text COLLATE "C" NOT NULL,
  "reason" text COLLATE "C",
  "status" text COLLATE "C" NOT NULL DEFAULT 'pending',
  "approver_id" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "decided_at" timestamptz,
  "decision_note" text COLLATE "C",
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "leaves_1_chk" CHECK ("to_date" >= "from_date"),
  CONSTRAINT "leaves_2_chk" CHECK ("status" NOT IN ('approved','rejected') OR ("approver_id" IS NOT NULL AND "decided_at" IS NOT NULL)),
  CONSTRAINT "leaves_3_chk" CHECK ("from_date" ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT "leaves_4_chk" CHECK ("to_date" ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT "leaves_5_chk" CHECK ("leave_type" IN ('casual', 'sick', 'earned', 'unpaid', 'other')),
  CONSTRAINT "leaves_6_chk" CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled'))
);
COMMENT ON TABLE "leads"."leaves" IS 'Leave applications and their approval by a manager or HR.';
ALTER TABLE "leads"."leaves" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "leaves__set_updated_at" BEFORE UPDATE ON "leads"."leaves" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE INDEX "leaves_employee_id_from_date_idx" ON "leads"."leaves" USING btree ("employee_id", "from_date" DESC);
CREATE INDEX "leaves_company_id_status_from_date_idx" ON "leads"."leaves" USING btree ("company_id", "status", "from_date");
CREATE INDEX "leaves_from_date_idx" ON "leads"."leaves" USING btree ("from_date");
CREATE INDEX "leaves_to_date_idx" ON "leads"."leaves" USING btree ("to_date");
CREATE INDEX "leaves_status_idx" ON "leads"."leaves" USING btree ("status");
CREATE INDEX "leaves_approver_id_idx" ON "leads"."leaves" USING btree ("approver_id");
REVOKE ALL ON "leads"."leaves" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."leaves" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."holidays" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "holiday_date" text COLLATE "C" NOT NULL,
  "name" text COLLATE "C" NOT NULL,
  "is_optional" boolean NOT NULL DEFAULT false,
  "created_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "holidays_1_chk" CHECK ("holiday_date" ~ '^\d{4}-\d{2}-\d{2}$')
);
COMMENT ON TABLE "leads"."holidays" IS 'Company holiday calendar used by attendance and payroll day counts.';
ALTER TABLE "leads"."holidays" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "holidays__set_updated_at" BEFORE UPDATE ON "leads"."holidays" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "holidays_company_id_holiday_date_key" ON "leads"."holidays" USING btree ("company_id", "holiday_date");
CREATE INDEX "holidays_holiday_date_idx" ON "leads"."holidays" USING btree ("holiday_date");
CREATE INDEX "holidays_created_by_idx" ON "leads"."holidays" USING btree ("created_by");
REVOKE ALL ON "leads"."holidays" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."holidays" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."salary_master" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "employee_id" text COLLATE "C" NOT NULL REFERENCES "leads"."employees"("id"),
  "fixed_salary" double precision NOT NULL,
  "effective_from" text COLLATE "C" NOT NULL,
  "created_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "salary_master_1_chk" CHECK ("fixed_salary" >= 0),
  CONSTRAINT "salary_master_2_chk" CHECK ("effective_from" ~ '^\d{4}-\d{2}-\d{2}$')
);
COMMENT ON TABLE "leads"."salary_master" IS 'Fixed monthly salary history per employee; the row with the latest effective_from not after the month applies.';
ALTER TABLE "leads"."salary_master" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "salary_master__set_updated_at" BEFORE UPDATE ON "leads"."salary_master" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "salary_master_employee_id_effective_from_key" ON "leads"."salary_master" USING btree ("employee_id", "effective_from");
CREATE INDEX "salary_master_company_id_idx" ON "leads"."salary_master" USING btree ("company_id");
CREATE INDEX "salary_master_effective_from_idx" ON "leads"."salary_master" USING btree ("effective_from");
CREATE INDEX "salary_master_created_by_idx" ON "leads"."salary_master" USING btree ("created_by");
REVOKE ALL ON "leads"."salary_master" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."salary_master" FROM %s', r); END IF; END LOOP; END $$;

CREATE TABLE "leads"."payroll" (
  "id" text COLLATE "C" PRIMARY KEY DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24),
  "company_id" text COLLATE "C" NOT NULL REFERENCES "leads"."companies"("id"),
  "employee_id" text COLLATE "C" NOT NULL REFERENCES "leads"."employees"("id"),
  "month" text COLLATE "C" NOT NULL,
  "fixed_salary" double precision NOT NULL,
  "calc_days" double precision NOT NULL,
  "payable_days" double precision NOT NULL,
  "unpaid_leave_days" double precision NOT NULL DEFAULT 0,
  "adjustments" double precision NOT NULL DEFAULT 0,
  "adjustment_note" text COLLATE "C",
  "net_payable" double precision NOT NULL,
  "status" text COLLATE "C" NOT NULL DEFAULT 'draft',
  "approved_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "approved_at" timestamptz,
  "finalized_by" text COLLATE "C" REFERENCES "leads"."lead_users"("id"),
  "finalized_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "_nulls" text[],
  "_extra" jsonb,
  CONSTRAINT "payroll_1_chk" CHECK ("payable_days" <= "calc_days"),
  CONSTRAINT "payroll_2_chk" CHECK ("adjustments" = 0 OR coalesce(btrim("adjustment_note"), '') <> ''),
  CONSTRAINT "payroll_3_chk" CHECK ("status" <> 'finalized' OR ("finalized_at" IS NOT NULL AND "finalized_by" IS NOT NULL)),
  CONSTRAINT "payroll_4_chk" CHECK ("status" = 'draft' OR "approved_by" IS NOT NULL),
  CONSTRAINT "payroll_5_chk" CHECK ("month" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "payroll_6_chk" CHECK ("fixed_salary" >= 0),
  CONSTRAINT "payroll_7_chk" CHECK ("calc_days" >= 1),
  CONSTRAINT "payroll_8_chk" CHECK ("payable_days" >= 0),
  CONSTRAINT "payroll_9_chk" CHECK ("unpaid_leave_days" >= 0),
  CONSTRAINT "payroll_10_chk" CHECK ("status" IN ('draft', 'approved', 'finalized'))
);
COMMENT ON TABLE "leads"."payroll" IS 'Monthly payroll per employee: fixed salary / calculation days x payable days + authorised adjustments. Finalized rows are locked by a trigger.';
ALTER TABLE "leads"."payroll" ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER "payroll__set_updated_at" BEFORE UPDATE ON "leads"."payroll" FOR EACH ROW EXECUTE FUNCTION "leads".set_updated_at();
CREATE UNIQUE INDEX "payroll_employee_id_month_key" ON "leads"."payroll" USING btree ("employee_id", "month");
CREATE INDEX "payroll_company_id_month_status_idx" ON "leads"."payroll" USING btree ("company_id", "month", "status");
CREATE INDEX "payroll_status_idx" ON "leads"."payroll" USING btree ("status");
CREATE INDEX "payroll_approved_by_idx" ON "leads"."payroll" USING btree ("approved_by");
CREATE INDEX "payroll_finalized_by_idx" ON "leads"."payroll" USING btree ("finalized_by");
CREATE OR REPLACE FUNCTION "leads".lock_finalized_payroll() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'finalized' THEN RAISE EXCEPTION 'payroll % is finalized and locked', OLD."id" USING ERRCODE = 'insufficient_privilege'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION "leads".lock_finalized_payroll() IS 'Rejects UPDATE/DELETE of a payroll row once it is finalized.';
CREATE TRIGGER "payroll_lock_finalized" BEFORE UPDATE OR DELETE ON "leads"."payroll" FOR EACH ROW EXECUTE FUNCTION "leads".lock_finalized_payroll();
REVOKE ALL ON "leads"."payroll" FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON "leads"."payroll" FROM %s', r); END IF; END LOOP; END $$;

