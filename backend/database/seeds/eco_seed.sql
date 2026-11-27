-- Eco Sor seed data: company, Super Admin, 9 roles + permissions, 10 products, 20 distributors, 8 employees, 2 holidays.
-- Run with: npm run db:seed        (npm run db:seed -- --dry-run rolls everything back)
-- Safe to re-run: every insert is ON CONFLICT DO NOTHING on a fixed id or a unique key.
-- {{PASSWORD_HASH}} is replaced by database/seed.js with a bcrypt hash; no password is stored in this file.
-- Phones 9000000001-9000000008 and distributor mobiles 98000000xx are placeholders: replace before real use.

INSERT INTO "leads"."companies" ("id","name","status","contact_person","contact_email","contact_phone","notes","created_by_admin_id","created_by_admin_name","created_at","updated_at")
VALUES ('ec05000000000000000000c0', 'Eco Sor', 'active', 'Eco Sor Admin', 'admin@ecosor.example', '9000000000', 'Seeded by database/seeds/eco_seed.sql', '', 'Seed', now(), now())
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "leads"."admin_users" ("id","name","email","password_hash","role","status","token_version","company_id","created_at","updated_at")
VALUES ('ec05000000000000000000a0', 'Eco Sor Admin', 'admin@ecosor.example', '{{PASSWORD_HASH}}', 'super_admin', 'active', 0, 'ec05000000000000000000c0', now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO "leads"."roles" ("id","company_id","code","name","description") VALUES
  ('ec0501000000000000000001', 'ec05000000000000000000c0', 'admin', 'Admin', 'Full access to everything in the company.'),
  ('ec0501000000000000000002', 'ec05000000000000000000c0', 'sales_manager', 'Sales Manager', 'Assigns distributor visits, reviews purchase requests and sales reports.'),
  ('ec0501000000000000000003', 'ec05000000000000000000c0', 'tele_sales', 'Tele-Sales', 'Calls distributors, logs calls and follow-ups, raises purchase requests.'),
  ('ec0501000000000000000004', 'ec05000000000000000000c0', 'field_sales', 'Field Sales', 'Visits distributors with GPS check-in, files reports, raises purchase requests.'),
  ('ec0501000000000000000005', 'ec05000000000000000000c0', 'support_manager', 'Support Manager', 'Reviews complaints, assigns engineers and monitors service work.'),
  ('ec0501000000000000000006', 'ec05000000000000000000c0', 'field_support', 'Field Support Engineer', 'Handles assigned complaints on site and files service reports.'),
  ('ec0501000000000000000007', 'ec05000000000000000000c0', 'hr', 'HR', 'Manages employees, attendance corrections, expenses, leave and payroll.'),
  ('ec0501000000000000000008', 'ec05000000000000000000c0', 'distributor', 'Distributor', 'Portal login: own purchase requests and payments only.'),
  ('ec0501000000000000000009', 'ec05000000000000000000c0', 'customer', 'Customer', 'Customer app: own products and complaints only.')
ON CONFLICT DO NOTHING;

INSERT INTO "leads"."permissions" ("id","code","module","description") VALUES
  ('ec0502000000000000000001', 'users.manage', 'users', 'Create and disable staff logins'),
  ('ec0502000000000000000002', 'roles.manage', 'roles', 'Edit roles and their permissions'),
  ('ec0502000000000000000003', 'settings.manage', 'settings', 'Change company settings'),
  ('ec0502000000000000000004', 'audit.view', 'audit', 'Read the audit log'),
  ('ec0502000000000000000005', 'reports.view', 'reports', 'Open operational reports'),
  ('ec0502000000000000000006', 'reports.export', 'reports', 'Export reports to CSV'),
  ('ec0502000000000000000007', 'products.view', 'products', 'See active products'),
  ('ec0502000000000000000008', 'products.manage', 'products', 'Add and edit products'),
  ('ec0502000000000000000009', 'distributors.view', 'distributors', 'See distributors'),
  ('ec0502000000000000000010', 'distributors.manage', 'distributors', 'Add, edit and assign distributors'),
  ('ec0502000000000000000011', 'distributors.import', 'distributors', 'Bulk import distributors from CSV'),
  ('ec0502000000000000000012', 'visits.view', 'visits', 'See sales visits'),
  ('ec0502000000000000000013', 'visits.assign', 'visits', 'Assign and reschedule sales visits'),
  ('ec0502000000000000000014', 'visits.checkin', 'visits', 'GPS check-in to an assigned visit'),
  ('ec0502000000000000000015', 'visits.report', 'visits', 'Submit a visit report'),
  ('ec0502000000000000000016', 'calls.log', 'calls', 'Log distributor calls'),
  ('ec0502000000000000000017', 'followups.manage', 'followups', 'Create and complete follow-ups'),
  ('ec0502000000000000000018', 'purchases.view', 'purchases', 'See purchase requests'),
  ('ec0502000000000000000019', 'purchases.create', 'purchases', 'Create and submit purchase requests'),
  ('ec0502000000000000000020', 'purchases.review', 'purchases', 'Review requests and ask for correction'),
  ('ec0502000000000000000021', 'purchases.approve', 'purchases', 'Approve or reject requests'),
  ('ec0502000000000000000022', 'purchases.process', 'purchases', 'Mark requests processed after external invoicing'),
  ('ec0502000000000000000023', 'payments.verify', 'payments', 'Verify or reject payments'),
  ('ec0502000000000000000024', 'complaints.view', 'complaints', 'See complaints'),
  ('ec0502000000000000000025', 'complaints.create', 'complaints', 'Raise a complaint (customer)'),
  ('ec0502000000000000000026', 'complaints.assign', 'complaints', 'Assign engineers to complaints'),
  ('ec0502000000000000000027', 'complaints.service', 'complaints', 'Check in, report and request the OTP on assigned jobs'),
  ('ec0502000000000000000028', 'complaints.close', 'complaints', 'Close a complaint after OTP verification'),
  ('ec0502000000000000000029', 'customers.manage', 'customers', 'Manage customers and their products'),
  ('ec0502000000000000000030', 'attendance.own', 'attendance', 'Check in/out and see own attendance'),
  ('ec0502000000000000000031', 'attendance.correct', 'attendance', 'Correct attendance with a reason'),
  ('ec0502000000000000000032', 'expenses.submit', 'expenses', 'Submit expenses'),
  ('ec0502000000000000000033', 'expenses.approve', 'expenses', 'Approve, reject and reimburse expenses'),
  ('ec0502000000000000000034', 'leaves.apply', 'leaves', 'Apply for leave'),
  ('ec0502000000000000000035', 'leaves.approve', 'leaves', 'Approve or reject leave'),
  ('ec0502000000000000000036', 'employees.manage', 'employees', 'Manage employee records'),
  ('ec0502000000000000000037', 'payroll.manage', 'payroll', 'Generate, approve and finalize payroll'),
  ('ec0502000000000000000038', 'notifications.view', 'notifications', 'See own notifications')
ON CONFLICT DO NOTHING;

-- admin holds every permission
INSERT INTO "leads"."role_permissions" ("company_id","role_id","permission_id")
SELECT 'ec05000000000000000000c0', 'ec0501000000000000000001', "id" FROM "leads"."permissions"
ON CONFLICT DO NOTHING;

INSERT INTO "leads"."role_permissions" ("company_id","role_id","permission_id")
SELECT 'ec05000000000000000000c0', r."id", pm."id"
  FROM (VALUES
  ('sales_manager', 'attendance.own'),
  ('sales_manager', 'expenses.submit'),
  ('sales_manager', 'leaves.apply'),
  ('sales_manager', 'notifications.view'),
  ('sales_manager', 'products.view'),
  ('sales_manager', 'distributors.view'),
  ('sales_manager', 'distributors.manage'),
  ('sales_manager', 'visits.view'),
  ('sales_manager', 'visits.assign'),
  ('sales_manager', 'followups.manage'),
  ('sales_manager', 'purchases.view'),
  ('sales_manager', 'purchases.create'),
  ('sales_manager', 'purchases.review'),
  ('sales_manager', 'reports.view'),
  ('sales_manager', 'reports.export'),
  ('sales_manager', 'expenses.approve'),
  ('sales_manager', 'leaves.approve'),
  ('tele_sales', 'attendance.own'),
  ('tele_sales', 'expenses.submit'),
  ('tele_sales', 'leaves.apply'),
  ('tele_sales', 'notifications.view'),
  ('tele_sales', 'products.view'),
  ('tele_sales', 'distributors.view'),
  ('tele_sales', 'calls.log'),
  ('tele_sales', 'followups.manage'),
  ('tele_sales', 'visits.view'),
  ('tele_sales', 'purchases.view'),
  ('tele_sales', 'purchases.create'),
  ('field_sales', 'attendance.own'),
  ('field_sales', 'expenses.submit'),
  ('field_sales', 'leaves.apply'),
  ('field_sales', 'notifications.view'),
  ('field_sales', 'products.view'),
  ('field_sales', 'distributors.view'),
  ('field_sales', 'visits.view'),
  ('field_sales', 'visits.checkin'),
  ('field_sales', 'visits.report'),
  ('field_sales', 'followups.manage'),
  ('field_sales', 'calls.log'),
  ('field_sales', 'purchases.view'),
  ('field_sales', 'purchases.create'),
  ('support_manager', 'attendance.own'),
  ('support_manager', 'expenses.submit'),
  ('support_manager', 'leaves.apply'),
  ('support_manager', 'notifications.view'),
  ('support_manager', 'complaints.view'),
  ('support_manager', 'complaints.assign'),
  ('support_manager', 'customers.manage'),
  ('support_manager', 'reports.view'),
  ('support_manager', 'reports.export'),
  ('support_manager', 'expenses.approve'),
  ('support_manager', 'leaves.approve'),
  ('field_support', 'attendance.own'),
  ('field_support', 'expenses.submit'),
  ('field_support', 'leaves.apply'),
  ('field_support', 'notifications.view'),
  ('field_support', 'complaints.view'),
  ('field_support', 'complaints.service'),
  ('hr', 'attendance.own'),
  ('hr', 'expenses.submit'),
  ('hr', 'leaves.apply'),
  ('hr', 'notifications.view'),
  ('hr', 'employees.manage'),
  ('hr', 'attendance.correct'),
  ('hr', 'expenses.approve'),
  ('hr', 'leaves.approve'),
  ('hr', 'payroll.manage'),
  ('hr', 'reports.view'),
  ('hr', 'reports.export'),
  ('hr', 'users.manage'),
  ('distributor', 'products.view'),
  ('distributor', 'purchases.view'),
  ('distributor', 'purchases.create'),
  ('distributor', 'notifications.view'),
  ('customer', 'complaints.view'),
  ('customer', 'complaints.create'),
  ('customer', 'notifications.view')
  ) AS g("role_code","perm_code")
  JOIN "leads"."roles" r ON r."company_id" = 'ec05000000000000000000c0' AND r."code" = g."role_code"
  JOIN "leads"."permissions" pm ON pm."code" = g."perm_code"
ON CONFLICT DO NOTHING;

INSERT INTO "leads"."lead_users" ("id","company_id","name","phone","email","password_hash","role","status","employee_code","created_by_admin_id","created_by_admin_name","role_id","is_active","token_version","created_at","updated_at")
VALUES ('ec0503000000000000000001', 'ec05000000000000000000c0', 'Rohit Verma', '9000000001', 'rohit.verma@ecosor.example', '{{PASSWORD_HASH}}', 'sales_manager', 'active', 'EMP001', 'ec05000000000000000000a0', 'Eco Sor Admin', 'ec0501000000000000000002', true, 0, now(), now())
ON CONFLICT DO NOTHING;
INSERT INTO "leads"."lead_users" ("id","company_id","name","phone","email","password_hash","role","status","employee_code","created_by_admin_id","created_by_admin_name","role_id","is_active","token_version","created_at","updated_at")
VALUES ('ec0503000000000000000002', 'ec05000000000000000000c0', 'Neha Kapoor', '9000000002', 'neha.kapoor@ecosor.example', '{{PASSWORD_HASH}}', 'tele_sales', 'active', 'EMP002', 'ec05000000000000000000a0', 'Eco Sor Admin', 'ec0501000000000000000003', true, 0, now(), now())
ON CONFLICT DO NOTHING;
INSERT INTO "leads"."lead_users" ("id","company_id","name","phone","email","password_hash","role","status","employee_code","created_by_admin_id","created_by_admin_name","role_id","is_active","token_version","created_at","updated_at")
VALUES ('ec0503000000000000000003', 'ec05000000000000000000c0', 'Imran Sheikh', '9000000003', 'imran.sheikh@ecosor.example', '{{PASSWORD_HASH}}', 'field_sales', 'active', 'EMP003', 'ec05000000000000000000a0', 'Eco Sor Admin', 'ec0501000000000000000004', true, 0, now(), now())
ON CONFLICT DO NOTHING;
INSERT INTO "leads"."lead_users" ("id","company_id","name","phone","email","password_hash","role","status","employee_code","created_by_admin_id","created_by_admin_name","role_id","is_active","token_version","created_at","updated_at")
VALUES ('ec0503000000000000000004', 'ec05000000000000000000c0', 'Pooja Nair', '9000000004', 'pooja.nair@ecosor.example', '{{PASSWORD_HASH}}', 'field_sales', 'active', 'EMP004', 'ec05000000000000000000a0', 'Eco Sor Admin', 'ec0501000000000000000004', true, 0, now(), now())
ON CONFLICT DO NOTHING;
INSERT INTO "leads"."lead_users" ("id","company_id","name","phone","email","password_hash","role","status","employee_code","created_by_admin_id","created_by_admin_name","role_id","is_active","token_version","created_at","updated_at")
VALUES ('ec0503000000000000000005', 'ec05000000000000000000c0', 'Anil Deshmukh', '9000000005', 'anil.deshmukh@ecosor.example', '{{PASSWORD_HASH}}', 'support_manager', 'active', 'EMP005', 'ec05000000000000000000a0', 'Eco Sor Admin', 'ec0501000000000000000005', true, 0, now(), now())
ON CONFLICT DO NOTHING;
INSERT INTO "leads"."lead_users" ("id","company_id","name","phone","email","password_hash","role","status","employee_code","created_by_admin_id","created_by_admin_name","role_id","is_active","token_version","created_at","updated_at")
VALUES ('ec0503000000000000000006', 'ec05000000000000000000c0', 'Sanjay Yadav', '9000000006', 'sanjay.yadav@ecosor.example', '{{PASSWORD_HASH}}', 'field_support', 'active', 'EMP006', 'ec05000000000000000000a0', 'Eco Sor Admin', 'ec0501000000000000000006', true, 0, now(), now())
ON CONFLICT DO NOTHING;
INSERT INTO "leads"."lead_users" ("id","company_id","name","phone","email","password_hash","role","status","employee_code","created_by_admin_id","created_by_admin_name","role_id","is_active","token_version","created_at","updated_at")
VALUES ('ec0503000000000000000007', 'ec05000000000000000000c0', 'Deepa Menon', '9000000007', 'deepa.menon@ecosor.example', '{{PASSWORD_HASH}}', 'field_support', 'active', 'EMP007', 'ec05000000000000000000a0', 'Eco Sor Admin', 'ec0501000000000000000006', true, 0, now(), now())
ON CONFLICT DO NOTHING;
INSERT INTO "leads"."lead_users" ("id","company_id","name","phone","email","password_hash","role","status","employee_code","created_by_admin_id","created_by_admin_name","role_id","is_active","token_version","created_at","updated_at")
VALUES ('ec0503000000000000000008', 'ec05000000000000000000c0', 'Kavita Joshi', '9000000008', 'kavita.joshi@ecosor.example', '{{PASSWORD_HASH}}', 'hr', 'active', 'EMP008', 'ec05000000000000000000a0', 'Eco Sor Admin', 'ec0501000000000000000007', true, 0, now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO "leads"."employees" ("id","company_id","user_id","employee_code","name","mobile","email","designation","department","role_id","manager_id","joining_date","fixed_salary","weekly_off","is_active","created_by")
VALUES ('ec0504000000000000000001', 'ec05000000000000000000c0', 'ec0503000000000000000001', 'EMP001', 'Rohit Verma', '9000000001', 'rohit.verma@ecosor.example', 'Sales Manager', 'Sales', 'ec0501000000000000000002', NULL, '2025-04-01', 65000, ARRAY['sunday'], true, 'ec0503000000000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO "leads"."employees" ("id","company_id","user_id","employee_code","name","mobile","email","designation","department","role_id","manager_id","joining_date","fixed_salary","weekly_off","is_active","created_by")
VALUES ('ec0504000000000000000002', 'ec05000000000000000000c0', 'ec0503000000000000000002', 'EMP002', 'Neha Kapoor', '9000000002', 'neha.kapoor@ecosor.example', 'Tele-Sales Executive', 'Sales', 'ec0501000000000000000003', 'ec0504000000000000000001', '2025-04-01', 28000, ARRAY['sunday'], true, 'ec0503000000000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO "leads"."employees" ("id","company_id","user_id","employee_code","name","mobile","email","designation","department","role_id","manager_id","joining_date","fixed_salary","weekly_off","is_active","created_by")
VALUES ('ec0504000000000000000003', 'ec05000000000000000000c0', 'ec0503000000000000000003', 'EMP003', 'Imran Sheikh', '9000000003', 'imran.sheikh@ecosor.example', 'Field Sales Executive', 'Sales', 'ec0501000000000000000004', 'ec0504000000000000000001', '2025-04-01', 32000, ARRAY['sunday'], true, 'ec0503000000000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO "leads"."employees" ("id","company_id","user_id","employee_code","name","mobile","email","designation","department","role_id","manager_id","joining_date","fixed_salary","weekly_off","is_active","created_by")
VALUES ('ec0504000000000000000004', 'ec05000000000000000000c0', 'ec0503000000000000000004', 'EMP004', 'Pooja Nair', '9000000004', 'pooja.nair@ecosor.example', 'Field Sales Executive', 'Sales', 'ec0501000000000000000004', 'ec0504000000000000000001', '2025-04-01', 32000, ARRAY['sunday'], true, 'ec0503000000000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO "leads"."employees" ("id","company_id","user_id","employee_code","name","mobile","email","designation","department","role_id","manager_id","joining_date","fixed_salary","weekly_off","is_active","created_by")
VALUES ('ec0504000000000000000005', 'ec05000000000000000000c0', 'ec0503000000000000000005', 'EMP005', 'Anil Deshmukh', '9000000005', 'anil.deshmukh@ecosor.example', 'Support Manager', 'Service', 'ec0501000000000000000005', NULL, '2025-04-01', 60000, ARRAY['sunday'], true, 'ec0503000000000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO "leads"."employees" ("id","company_id","user_id","employee_code","name","mobile","email","designation","department","role_id","manager_id","joining_date","fixed_salary","weekly_off","is_active","created_by")
VALUES ('ec0504000000000000000006', 'ec05000000000000000000c0', 'ec0503000000000000000006', 'EMP006', 'Sanjay Yadav', '9000000006', 'sanjay.yadav@ecosor.example', 'Service Engineer', 'Service', 'ec0501000000000000000006', 'ec0504000000000000000005', '2025-04-01', 30000, ARRAY['sunday'], true, 'ec0503000000000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO "leads"."employees" ("id","company_id","user_id","employee_code","name","mobile","email","designation","department","role_id","manager_id","joining_date","fixed_salary","weekly_off","is_active","created_by")
VALUES ('ec0504000000000000000007', 'ec05000000000000000000c0', 'ec0503000000000000000007', 'EMP007', 'Deepa Menon', '9000000007', 'deepa.menon@ecosor.example', 'Service Engineer', 'Service', 'ec0501000000000000000006', 'ec0504000000000000000005', '2025-04-01', 30000, ARRAY['sunday'], true, 'ec0503000000000000000001')
ON CONFLICT DO NOTHING;
INSERT INTO "leads"."employees" ("id","company_id","user_id","employee_code","name","mobile","email","designation","department","role_id","manager_id","joining_date","fixed_salary","weekly_off","is_active","created_by")
VALUES ('ec0504000000000000000008', 'ec05000000000000000000c0', 'ec0503000000000000000008', 'EMP008', 'Kavita Joshi', '9000000008', 'kavita.joshi@ecosor.example', 'HR Executive', 'HR', 'ec0501000000000000000007', NULL, '2025-04-01', 45000, ARRAY['sunday'], true, 'ec0503000000000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO "leads"."products" ("id","company_id","product_code","category","name","model","sku","description","is_active") VALUES
  ('ec0505000000000000000001', 'ec05000000000000000000c0', 'EP-INV-001', 'inverter', 'Eco Sor Pure Sine 900VA', 'ES-PS900', 'ECO-INV-PS900', '', true),
  ('ec0505000000000000000002', 'ec05000000000000000000c0', 'EP-INV-002', 'inverter', 'Eco Sor Pure Sine 1100VA', 'ES-PS1100', 'ECO-INV-PS1100', '', true),
  ('ec0505000000000000000003', 'ec05000000000000000000c0', 'EP-INV-003', 'inverter', 'Eco Sor Solar Hybrid 1.5kVA', 'ES-SH1500', 'ECO-INV-SH1500', '', true),
  ('ec0505000000000000000004', 'ec05000000000000000000c0', 'EP-INV-004', 'inverter', 'Eco Sor Solar Hybrid 3kVA', 'ES-SH3000', 'ECO-INV-SH3000', '', true),
  ('ec0505000000000000000005', 'ec05000000000000000000c0', 'EP-INV-005', 'inverter', 'Eco Sor Solar Hybrid 5kVA', 'ES-SH5000', 'ECO-INV-SH5000', '', true),
  ('ec0505000000000000000006', 'ec05000000000000000000c0', 'EP-BAT-001', 'battery', 'Eco Sor Tubular 150Ah', 'ES-TB150', 'ECO-BAT-TB150', '', true),
  ('ec0505000000000000000007', 'ec05000000000000000000c0', 'EP-BAT-002', 'battery', 'Eco Sor Tubular 200Ah', 'ES-TB200', 'ECO-BAT-TB200', '', true),
  ('ec0505000000000000000008', 'ec05000000000000000000c0', 'EP-BAT-003', 'battery', 'Eco Sor Tall Tubular 220Ah', 'ES-TT220', 'ECO-BAT-TT220', '', true),
  ('ec0505000000000000000009', 'ec05000000000000000000c0', 'EP-BAT-004', 'battery', 'Eco Sor Lithium 100Ah 12V', 'ES-LI100', 'ECO-BAT-LI100', '', true),
  ('ec0505000000000000000010', 'ec05000000000000000000c0', 'EP-BAT-005', 'battery', 'Eco Sor Lithium 200Ah 24V', 'ES-LI200', 'ECO-BAT-LI200', '', true)
ON CONFLICT DO NOTHING;

INSERT INTO "leads"."distributors" ("id","company_id","distributor_code","firm_name","contact_person","mobile","alt_mobile","email","gstin","address","city","state","pin","assigned_executive_id","remarks","is_active","portal_access") VALUES
  ('ec0506000000000000000001', 'ec05000000000000000000c0', 'DST0001', 'Sharma Power Solutions', 'Ramesh Sharma', '9800000001', NULL, 'sharmapowersolutions@example.com', '10ABCDE1000F1ZA', 'Shop 1, Main Market', 'Jaipur', 'Rajasthan', '302001', 'ec0504000000000000000002', '', true, false),
  ('ec0506000000000000000002', 'ec05000000000000000000c0', 'DST0002', 'Gupta Electricals', 'Sunil Gupta', '9800000002', NULL, 'guptaelectricals@example.com', '11ABCDE1037F1ZB', 'Shop 2, Main Market', 'Delhi', 'Delhi', '110001', 'ec0504000000000000000003', '', true, false),
  ('ec0506000000000000000003', 'ec05000000000000000000c0', 'DST0003', 'Bright Energy Traders', 'Anita Bright', '9800000003', NULL, 'brightenergytraders@example.com', '12ABCDE1074F1ZC', 'Shop 3, Main Market', 'Lucknow', 'Uttar Pradesh', '226001', 'ec0504000000000000000004', '', true, false),
  ('ec0506000000000000000004', 'ec05000000000000000000c0', 'DST0004', 'Om Sai Batteries', 'Mahesh Om', '9800000004', NULL, 'omsaibatteries@example.com', '13ABCDE1111F1ZD', 'Shop 4, Main Market', 'Indore', 'Madhya Pradesh', '452001', 'ec0504000000000000000002', '', true, false),
  ('ec0506000000000000000005', 'ec05000000000000000000c0', 'DST0005', 'Kumar Inverter House', 'Vinod Kumar', '9800000005', NULL, 'kumarinverterhouse@example.com', '14ABCDE1148F1ZE', 'Shop 5, Main Market', 'Pune', 'Maharashtra', '411001', 'ec0504000000000000000003', '', true, false),
  ('ec0506000000000000000006', 'ec05000000000000000000c0', 'DST0006', 'Shree Ganesh Electronics', 'Ganesh Shree', '9800000006', NULL, 'shreeganeshelectronics@example.com', '15ABCDE1185F1ZF', 'Shop 6, Main Market', 'Ahmedabad', 'Gujarat', '380001', 'ec0504000000000000000004', '', true, false),
  ('ec0506000000000000000007', 'ec05000000000000000000c0', 'DST0007', 'National Power Hub', 'Dinesh Nath', '9800000007', NULL, 'nationalpowerhub@example.com', '16ABCDE1222F1ZG', 'Shop 7, Main Market', 'Patna', 'Bihar', '800001', 'ec0504000000000000000002', '', true, false),
  ('ec0506000000000000000008', 'ec05000000000000000000c0', 'DST0008', 'Singh Solar Mart', 'Harpreet Singh', '9800000008', NULL, 'singhsolarmart@example.com', '17ABCDE1259F1ZH', 'Shop 8, Main Market', 'Bhopal', 'Madhya Pradesh', '462001', 'ec0504000000000000000003', '', true, false),
  ('ec0506000000000000000009', 'ec05000000000000000000c0', 'DST0009', 'Patel Battery World', 'Kiran Patel', '9800000009', NULL, 'patelbatteryworld@example.com', '18ABCDE1296F1ZJ', 'Shop 9, Main Market', 'Nagpur', 'Maharashtra', '440001', 'ec0504000000000000000004', '', true, false),
  ('ec0506000000000000000010', 'ec05000000000000000000c0', 'DST0010', 'Mehta Energy Systems', 'Alok Mehta', '9800000010', NULL, 'mehtaenergysystems@example.com', '19ABCDE1333F1ZK', 'Shop 10, Main Market', 'Kanpur', 'Uttar Pradesh', '208001', 'ec0504000000000000000002', '', true, false),
  ('ec0506000000000000000011', 'ec05000000000000000000c0', 'DST0011', 'Rajput Traders', 'Bharat Rajput', '9800000011', NULL, 'rajputtraders@example.com', '20ABCDE1370F1ZL', 'Shop 11, Main Market', 'Jaipur', 'Rajasthan', '302001', 'ec0504000000000000000003', '', true, false),
  ('ec0506000000000000000012', 'ec05000000000000000000c0', 'DST0012', 'Jain Power Centre', 'Naresh Jain', '9800000012', NULL, 'jainpowercentre@example.com', '21ABCDE1407F1ZM', 'Shop 12, Main Market', 'Delhi', 'Delhi', '110001', 'ec0504000000000000000004', '', true, false),
  ('ec0506000000000000000013', 'ec05000000000000000000c0', 'DST0013', 'Agarwal Electricals', 'Sandeep Agarwal', '9800000013', NULL, 'agarwalelectricals@example.com', '22ABCDE1444F1ZN', 'Shop 13, Main Market', 'Lucknow', 'Uttar Pradesh', '226001', 'ec0504000000000000000002', '', true, false),
  ('ec0506000000000000000014', 'ec05000000000000000000c0', 'DST0014', 'Sunrise Inverters', 'Rakesh Sunrise', '9800000014', NULL, 'sunriseinverters@example.com', '23ABCDE1481F1ZP', 'Shop 14, Main Market', 'Indore', 'Madhya Pradesh', '452001', 'ec0504000000000000000003', '', true, false),
  ('ec0506000000000000000015', 'ec05000000000000000000c0', 'DST0015', 'Metro Battery Point', 'Mohan Metro', '9800000015', NULL, 'metrobatterypoint@example.com', '24ABCDE1518F1ZQ', 'Shop 15, Main Market', 'Pune', 'Maharashtra', '411001', 'ec0504000000000000000004', '', true, false),
  ('ec0506000000000000000016', 'ec05000000000000000000c0', 'DST0016', 'Verma Solar Store', 'Ajay Verma', '9800000016', NULL, 'vermasolarstore@example.com', '25ABCDE1555F1ZR', 'Shop 16, Main Market', 'Ahmedabad', 'Gujarat', '380001', 'ec0504000000000000000002', '', true, false),
  ('ec0506000000000000000017', 'ec05000000000000000000c0', 'DST0017', 'Anand Power Systems', 'Vikas Anand', '9800000017', NULL, 'anandpowersystems@example.com', '26ABCDE1592F1ZS', 'Shop 17, Main Market', 'Patna', 'Bihar', '800001', 'ec0504000000000000000003', '', true, false),
  ('ec0506000000000000000018', 'ec05000000000000000000c0', 'DST0018', 'Khan Electronics', 'Salim Khan', '9800000018', NULL, 'khanelectronics@example.com', '27ABCDE1629F1ZT', 'Shop 18, Main Market', 'Bhopal', 'Madhya Pradesh', '462001', 'ec0504000000000000000004', '', true, false),
  ('ec0506000000000000000019', 'ec05000000000000000000c0', 'DST0019', 'Reddy Energy Traders', 'Prasad Reddy', '9800000019', NULL, 'reddyenergytraders@example.com', '28ABCDE1666F1ZU', 'Shop 19, Main Market', 'Nagpur', 'Maharashtra', '440001', 'ec0504000000000000000002', '', true, false),
  ('ec0506000000000000000020', 'ec05000000000000000000c0', 'DST0020', 'Joshi Power Hub', 'Manoj Joshi', '9800000020', NULL, 'joshipowerhub@example.com', '29ABCDE1703F1ZV', 'Shop 20, Main Market', 'Kanpur', 'Uttar Pradesh', '208001', 'ec0504000000000000000003', '', true, false)
ON CONFLICT DO NOTHING;

INSERT INTO "leads"."distributor_assignments" ("company_id","distributor_id","employee_id","assigned_by","reason")
SELECT d."company_id", d."id", d."assigned_executive_id", 'ec0503000000000000000001', 'Initial assignment (seed)'
  FROM "leads"."distributors" d
 WHERE d."company_id" = 'ec05000000000000000000c0' AND d."assigned_executive_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "leads"."distributor_assignments" a WHERE a."distributor_id" = d."id" AND a."unassigned_at" IS NULL);

INSERT INTO "leads"."holidays" ("id","company_id","holiday_date","name","is_optional") VALUES
  ('ec0507000000000000000001', 'ec05000000000000000000c0', '2026-12-25', 'Christmas Day', false),
  ('ec0507000000000000000002', 'ec05000000000000000000c0', '2027-01-26', 'Republic Day', false)
ON CONFLICT DO NOTHING;
