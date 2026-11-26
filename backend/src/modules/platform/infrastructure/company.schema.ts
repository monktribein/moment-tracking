import { Schema } from "../../../database/orm";
import { COMPANY_COLLECTION, COMPANY_STATUSES } from "../domain/platform.constants";

/**
 * A customer company. Every staff account, lead, region, attendance row and GPS
 * point carries the `companyId` of the company it belongs to, and a Super
 * Admin only ever reads and writes rows of their own company.
 */
export const CompanySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: COMPANY_STATUSES, default: "active" },
    contactPerson: { type: String, trim: true, default: "" },
    contactEmail: { type: String, trim: true, lowercase: true, default: "" },
    contactPhone: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },
    createdByAdminId: { type: String, immutable: true, default: "" },
    createdByAdminName: { type: String, immutable: true, default: "" },
  },
  {
    timestamps: true,
    collection: COMPANY_COLLECTION,
    optimisticConcurrency: true,
  },
);

CompanySchema.index({ name: 1 });
