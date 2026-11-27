import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { EcoAuthService } from "../application/eco-auth.service";
import type { Principal } from "../domain/principal";
import { ECO_OPEN_KEY } from "./decorators";

export interface EcoRequest extends Request {
  ecoUser?: Principal;
}

/** Signs the caller in from `Authorization: Bearer <token>` and puts the Principal on the request. */
@Injectable()
export class EcoAuthGuard implements CanActivate {
  constructor(
    private readonly auth: EcoAuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(ECO_OPEN_KEY, [context.getHandler(), context.getClass()])) return true;
    const request = context.switchToHttp().getRequest<EcoRequest>();
    const [scheme, token] = (request.headers.authorization ?? "").split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) throw new UnauthorizedException("Sign in required");
    const principal = await this.auth.verifyToken(token);
    principal.ip = request.ip;
    request.ecoUser = principal;
    return true;
  }
}
