import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { can } from "../domain/principal";
import { ECO_OPEN_KEY, ECO_ROLES_KEY, PERMISSIONS_KEY } from "./decorators";
import type { EcoRequest } from "./eco-auth.guard";

/** Server-side authorization: @RequireRoles(...) and @Permissions(...) on the route. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(ECO_OPEN_KEY, targets)) return true;
    const principal = context.switchToHttp().getRequest<EcoRequest>().ecoUser;
    if (!principal) throw new ForbiddenException("Not allowed");
    const roles = this.reflector.getAllAndOverride<string[]>(ECO_ROLES_KEY, targets);
    if (roles?.length && principal.role !== "admin" && !roles.includes(principal.role)) throw new ForbiddenException("Your role cannot do this");
    const permissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets);
    if (permissions?.length && !permissions.some((p) => can(principal, p))) throw new ForbiddenException("You do not have permission to do this");
    return true;
  }
}
