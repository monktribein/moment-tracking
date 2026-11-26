export const COMPANY_MODEL = "Company";
export const COMPANY_COLLECTION = "companies";

/** A suspended company's Super Admins and staff cannot sign in. */
export const COMPANY_STATUSES = ["active", "suspended"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const COMPANY_SUSPENDED_MESSAGE =
  "This company's account is suspended. Contact the platform owner.";
