import { applyDecorators, Controller, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Public } from "../../../common/decorators/public.decorator";
import { EcoAuthGuard } from "./eco-auth.guard";
import { PermissionsGuard } from "./permissions.guard";

/**
 * A /api/v1/<path> controller of the Eco Sor platform. It opts out of the
 * Super Admin console's JWT guard (@Public) and uses its own: EcoAuthGuard
 * (company staff, distributors, customers, or a company Super Admin) and
 * PermissionsGuard (@Permissions / @RequireRoles). Mark open routes @OpenRoute().
 */
export const EcoController = (path: string, tag: string) =>
  applyDecorators(Controller({ path, version: "1" }), Public(), ApiTags(tag), ApiBearerAuth(), UseGuards(EcoAuthGuard, PermissionsGuard));
