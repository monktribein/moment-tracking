import { createParamDecorator } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";

export interface AuthenticatedUser {
  _id: string;
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  status: string;
  /** The company a Super Admin runs; null for the platform owner. */
  companyId?: string | null;
  permissions: string[];
  scopedAshramIds: string[];
  employerAshramId?: string;
  scopedTempleIds: string[];
  employerTempleId?: string;
  district?: string;
  state?: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user,
);
