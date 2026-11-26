import { Schema } from "../../../../database/orm";
import { LEAD_REGION_COLLECTION } from "../../domain/lead-collection.constants";

export const LeadRegionSchema = new Schema(
  {
    companyId: { type: String, required: true, immutable: true },
    state: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },
    createdByAdminId: { type: String, required: true, immutable: true },
    createdByAdminName: { type: String, immutable: true, default: "" },
  },
  { timestamps: true, collection: LEAD_REGION_COLLECTION },
);

// Each company keeps its own region list: two companies may both add the same district.
LeadRegionSchema.index({ companyId: 1, state: 1, district: 1 }, { unique: true });
