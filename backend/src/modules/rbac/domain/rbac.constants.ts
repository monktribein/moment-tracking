/** Eco Sor roles, the permission catalogue and each role's default grants. */

export const ECO_ROLES = [
  "admin",
  "sales_manager",
  "tele_sales",
  "field_sales",
  "support_manager",
  "field_support",
  "hr",
  "distributor",
  "customer",
] as const;
export type EcoRole = (typeof ECO_ROLES)[number];

export const ROLE_DEFS: Record<EcoRole, { name: string; description: string }> = {
  admin: { name: "Admin", description: "Full access to everything in the company." },
  sales_manager: { name: "Sales Manager", description: "Assigns distributor visits, reviews purchase requests and sales reports." },
  tele_sales: { name: "Tele-Sales", description: "Calls distributors, logs calls and follow-ups, raises purchase requests." },
  field_sales: { name: "Field Sales", description: "Visits distributors with GPS check-in, files reports, raises purchase requests." },
  support_manager: { name: "Support Manager", description: "Reviews complaints, assigns engineers and monitors service work." },
  field_support: { name: "Field Support Engineer", description: "Handles assigned complaints on site and files service reports." },
  hr: { name: "HR", description: "Manages employees, attendance corrections, expenses, leave and payroll." },
  distributor: { name: "Distributor", description: "Portal login: own purchase requests and payments only." },
  customer: { name: "Customer", description: "Customer app: own products and complaints only." },
};

/** Staff roles an employee record may carry (distributors and customers have their own tables). */
export const EMPLOYEE_ROLES: readonly EcoRole[] = ["admin", "sales_manager", "tele_sales", "field_sales", "support_manager", "field_support", "hr"];

export const PERMISSIONS: Record<string, string> = {
  "users.manage": "Create and disable staff logins",
  "roles.manage": "Edit roles and their permissions",
  "settings.manage": "Change company settings",
  "audit.view": "Read the audit log",
  "dashboard.view": "Open the dashboard for your role",
  "reports.view": "Open operational reports",
  "reports.export": "Export reports to CSV",
  "products.view": "See active products",
  "products.manage": "Add and edit products",
  "distributors.view": "See distributors",
  "distributors.manage": "Add, edit and assign distributors",
  "distributors.import": "Bulk import distributors from CSV",
  "visits.view": "See sales visits",
  "visits.assign": "Assign and reschedule sales visits",
  "visits.checkin": "GPS check-in to an assigned visit",
  "visits.report": "Submit a visit report",
  "calls.log": "Log distributor calls",
  "followups.manage": "Create and complete follow-ups",
  "purchases.view": "See purchase requests",
  "purchases.create": "Create and submit purchase requests",
  "purchases.review": "Review requests and ask for correction",
  "purchases.approve": "Approve or reject requests",
  "purchases.process": "Mark requests processed after external invoicing",
  "payments.verify": "Verify or reject payments",
  "complaints.view": "See complaints",
  "complaints.create": "Raise a complaint (customer)",
  "complaints.assign": "Assign engineers to complaints",
  "complaints.service": "Check in, report and request the OTP on assigned jobs",
  "complaints.close": "Close a complaint after OTP verification",
  "customers.manage": "Manage customers and their products",
  "customers.self": "Manage own customer profile and products",
  "attendance.own": "Check in/out and see own attendance",
  "attendance.view": "See everyone's attendance",
  "attendance.correct": "Correct attendance with a reason",
  "expenses.submit": "Submit expenses",
  "expenses.approve": "Approve, reject and reimburse expenses",
  "leaves.apply": "Apply for leave",
  "leaves.approve": "Approve or reject leave",
  "holidays.manage": "Maintain the holiday calendar",
  "employees.manage": "Manage employee records",
  "payroll.manage": "Generate, approve and finalize payroll",
  "notifications.view": "See own notifications",
};

const COMMON = ["attendance.own", "expenses.submit", "leaves.apply", "notifications.view", "dashboard.view"];

/** admin holds every permission ("*"); the others are listed. */
export const DEFAULT_GRANTS: Record<Exclude<EcoRole, "admin">, string[]> = {
  sales_manager: [...COMMON, "products.view", "distributors.view", "distributors.manage", "visits.view", "visits.assign", "followups.manage", "calls.log", "purchases.view", "purchases.create", "purchases.review", "reports.view", "reports.export", "expenses.approve", "leaves.approve", "attendance.view"],
  tele_sales: [...COMMON, "products.view", "distributors.view", "calls.log", "followups.manage", "visits.view", "purchases.view", "purchases.create"],
  field_sales: [...COMMON, "products.view", "distributors.view", "visits.view", "visits.checkin", "visits.report", "followups.manage", "calls.log", "purchases.view", "purchases.create"],
  support_manager: [...COMMON, "complaints.view", "complaints.assign", "complaints.close", "customers.manage", "reports.view", "reports.export", "expenses.approve", "leaves.approve", "attendance.view"],
  field_support: [...COMMON, "complaints.view", "complaints.service", "complaints.close"],
  hr: [...COMMON, "employees.manage", "users.manage", "attendance.view", "attendance.correct", "expenses.approve", "leaves.approve", "holidays.manage", "payroll.manage", "reports.view", "reports.export"],
  distributor: ["products.view", "distributors.view", "purchases.view", "purchases.create", "notifications.view", "dashboard.view"],
  customer: ["complaints.view", "complaints.create", "customers.self", "notifications.view"],
};

/** Bump when DEFAULT_GRANTS gains entries: companies get the new defaults added once (nothing is removed). */
export const GRANTS_VERSION = 3;

export const ALL_PERMISSIONS = "*";
