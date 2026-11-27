import { createParamDecorator, SetMetadata } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Principal } from "../domain/principal";

export const PERMISSIONS_KEY = "eco:permissions";
export const ECO_ROLES_KEY = "eco:roles";
export const ECO_OPEN_KEY = "eco:open";

/** The caller needs ANY ONE of these permissions (the company admin always passes). */
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** The caller's role must be one of these (the company admin always passes). */
export const RequireRoles = (...roles: string[]) => SetMetadata(ECO_ROLES_KEY, roles);

/** No sign-in needed (login, registration, password reset). */
export const OpenRoute = () => SetMetadata(ECO_OPEN_KEY, true);

/** The signed-in Eco Sor user (see Principal). */
export const Actor = createParamDecorator((_data: unknown, context: ExecutionContext): Principal => {
  return context.switchToHttp().getRequest<{ ecoUser: Principal }>().ecoUser;
});
