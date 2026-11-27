-- Fixes 0004 for the existing lead-user code: the model layer writes every registered column and sends NULL
-- for the ones a model does not set, so "is_active boolean NOT NULL" made POST /api/lead-collection/admin/users fail.
-- is_active may now be NULL on the way in; a trigger turns that into true, so old-style accounts stay active.

ALTER TABLE "leads"."lead_users" ALTER COLUMN "is_active" DROP NOT NULL;

CREATE OR REPLACE FUNCTION "leads".lead_users_default_active() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."is_active" IS NULL THEN NEW."is_active" := true; END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION "leads".lead_users_default_active() IS 'Sets lead_users.is_active to true when an insert (or update) leaves it NULL, as the model layer does for columns it does not know.';

DROP TRIGGER IF EXISTS "lead_users_default_active" ON "leads"."lead_users";
CREATE TRIGGER "lead_users_default_active" BEFORE INSERT OR UPDATE ON "leads"."lead_users" FOR EACH ROW EXECUTE FUNCTION "leads".lead_users_default_active();

UPDATE "leads"."lead_users" SET "is_active" = true WHERE "is_active" IS NULL;
