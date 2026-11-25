-- Table descriptions without the old project name, for databases where 0001 already ran.
-- Comments only: no table, column or data changes.

BEGIN;

COMMENT ON TABLE "leads"."lead_attendances" IS 'Model collection lead_attendances. Layout: src/database/pg/registry.generated.ts';
COMMENT ON TABLE "leads"."lead_location_pings" IS 'Model collection lead_location_pings. Layout: src/database/pg/registry.generated.ts';
COMMENT ON TABLE "leads"."lead_regions" IS 'Model collection lead_regions. Layout: src/database/pg/registry.generated.ts';
COMMENT ON TABLE "leads"."lead_users" IS 'Model collection lead_users. Layout: src/database/pg/registry.generated.ts';
COMMENT ON TABLE "leads"."leads" IS 'Model collection leads. Layout: src/database/pg/registry.generated.ts';
COMMENT ON TABLE "leads"."admin_users" IS 'Model collection admin_users. Layout: src/database/pg/registry.generated.ts';

COMMIT;
