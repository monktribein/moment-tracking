import type { Where } from "../../../common/eco/pagination";
import type { Principal } from "../../rbac/domain/principal";

/** Roles that only see the distributors assigned to them. */
export const ASSIGNED_ONLY_ROLES = ["tele_sales", "field_sales"];

/**
 * Ownership filter for distributor rows (alias `d`):
 * a distributor sees only itself, tele/field sales only their assigned distributors,
 * managers and admins every distributor of the company.
 */
export function scopeDistributors(actor: Principal, where: Where, alias = "d"): void {
  where.eq(`${alias}.company_id = ?`, actor.companyId);
  if (actor.role === "distributor") where.eq(`${alias}.id = ?`, actor.distributorId ?? "none");
  else if (ASSIGNED_ONLY_ROLES.includes(actor.role)) where.eq(`${alias}.assigned_executive_id = ?`, actor.employeeId ?? "none");
}

/** Whether the caller may act for this distributor (used by sales and purchases). */
export function canActFor(actor: Principal, distributor: { id: string; assignedExecutiveId: string | null }): boolean {
  if (actor.role === "distributor") return actor.distributorId === distributor.id;
  if (ASSIGNED_ONLY_ROLES.includes(actor.role)) return Boolean(actor.employeeId) && distributor.assignedExecutiveId === actor.employeeId;
  return true;
}

export interface ImportedDistributor {
  distributorCode?: string;
  firmName: string;
  contactPerson: string;
  mobile: string;
  altMobile?: string;
  email?: string;
  gstin?: string;
  address?: string;
  city?: string;
  state?: string;
  pin?: string;
  remarks?: string;
  executiveCode?: string;
}

const HEADER_ALIASES: Record<string, keyof ImportedDistributor> = {
  distributor_code: "distributorCode", code: "distributorCode",
  firm_name: "firmName", firm: "firmName", name: "firmName",
  contact_person: "contactPerson", contact: "contactPerson",
  mobile: "mobile", phone: "mobile",
  alt_mobile: "altMobile", alternate_mobile: "altMobile",
  email: "email", gstin: "gstin", gst: "gstin",
  address: "address", city: "city", state: "state", pin: "pin", pincode: "pin",
  remarks: "remarks", executive_code: "executiveCode", employee_code: "executiveCode",
};

export const normaliseHeader = (h: string): string => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function mapHeaders(headers: string[]): { columns: (keyof ImportedDistributor | null)[]; unknown: string[] } {
  const unknown: string[] = [];
  const columns = headers.map((h) => {
    const key = HEADER_ALIASES[normaliseHeader(h)];
    if (!key) unknown.push(h);
    return key ?? null;
  });
  return { columns, unknown };
}

const digits10 = (v: string | undefined): string => String(v ?? "").replace(/\D/g, "").slice(-10);

/** Validates one CSV row. Returns the clean record or every problem found (row-wise report). */
export function validateImportRow(raw: Partial<Record<keyof ImportedDistributor, string>>): { value?: ImportedDistributor; errors: string[] } {
  const errors: string[] = [];
  const t = (k: keyof ImportedDistributor) => (raw[k] ?? "").trim();
  const firmName = t("firmName");
  const contactPerson = t("contactPerson");
  const mobile = digits10(raw.mobile);
  if (!firmName) errors.push("firm_name is required");
  if (!contactPerson) errors.push("contact_person is required");
  if (!/^[6-9]\d{9}$/.test(mobile)) errors.push("mobile must be a valid 10-digit number");
  const altMobile = t("altMobile") ? digits10(raw.altMobile) : "";
  if (altMobile && !/^[6-9]\d{9}$/.test(altMobile)) errors.push("alt_mobile must be a valid 10-digit number");
  const email = t("email").toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("email is not valid");
  const gstin = t("gstin").toUpperCase();
  if (gstin && !/^[0-9A-Z]{15}$/.test(gstin)) errors.push("gstin must be 15 letters/digits");
  const pin = t("pin");
  if (pin && !/^\d{6}$/.test(pin)) errors.push("pin must be 6 digits");
  for (const [k, max] of [["firmName", 160], ["contactPerson", 120], ["address", 300], ["city", 80], ["state", 80], ["remarks", 500]] as const)
    if (t(k).length > max) errors.push(`${k} is longer than ${max} characters`);
  if (errors.length) return { errors };
  return {
    errors,
    value: { distributorCode: t("distributorCode") || undefined, firmName, contactPerson, mobile, altMobile: altMobile || undefined, email: email || undefined, gstin: gstin || undefined, address: t("address") || undefined, city: t("city") || undefined, state: t("state") || undefined, pin: pin || undefined, remarks: t("remarks") || undefined, executiveCode: t("executiveCode") || undefined },
  };
}
