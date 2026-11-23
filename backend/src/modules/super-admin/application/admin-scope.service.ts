import { Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "../../../common/decorators/current-user.decorator";
import type { LocationScope } from "../../../common/auth/location-scope";
import { SUPER_ADMIN_ROLE } from "../domain/super-admin.constants";

/**
 * Stands in for Tirvona's HrLocationService in the lead admin controller (same
 * `scopeFor` contract). There are no HR offices here: a Super Admin is never
 * area-restricted (null = every record), and any other role sees nothing.
 */
@Injectable()
export class AdminScopeService {
  async scopeFor(user: AuthenticatedUser | undefined | null): Promise<LocationScope> {
    if (user?.role === SUPER_ADMIN_ROLE) return null;
    return { city: "", officeName: "", area: "", terms: [] };
  }
}
