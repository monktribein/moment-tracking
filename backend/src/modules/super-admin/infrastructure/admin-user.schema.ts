import { Schema } from "../../../database/orm";
import {
  ADMIN_ROLES,
  ADMIN_STATUSES,
  ADMIN_USER_COLLECTION,
  SUPER_ADMIN_ROLE,
} from "../domain/super-admin.constants";

/**
 * Console accounts: the platform owner and each company's Super Admins.
 * Field agents and other staff live in lead_users, not here.
 */
export const AdminUserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ADMIN_ROLES, default: SUPER_ADMIN_ROLE },
    status: { type: String, enum: ADMIN_STATUSES, default: "active" },
    /** The company a Super Admin runs (companies._id); null for the platform owner. */
    companyId: { type: String, default: null, index: true },
    tokenVersion: { type: Number, default: 0 },
    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: ADMIN_USER_COLLECTION,
    optimisticConcurrency: true,
  },
);
