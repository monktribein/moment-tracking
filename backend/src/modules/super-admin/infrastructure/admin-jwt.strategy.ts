import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { InjectModel } from "../../../database/orm-nest";
import type { Model } from "../../../database/orm";
import type { AuthenticatedUser } from "../../../common/decorators/current-user.decorator";
import { LEAD_CONNECTION } from "../../lead-collection/domain/lead-collection.constants";
import { ADMIN_TOKEN_SCOPE, ADMIN_USER_MODEL, type AdminTokenPayload } from "../domain/super-admin.constants";

/**
 * The "jwt" strategy the global JwtAuthGuard runs on every non-public route.
 * Only Super Admin console tokens pass: field-agent tokens have a different
 * issuer, audience and scope and are refused.
 */
@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectModel(ADMIN_USER_MODEL, LEAD_CONNECTION)
    private readonly admins: Model<any>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>("jwtSecret") || "development-only-secret",
      issuer: config.get<string>("jwtIssuer"),
      audience: config.get<string>("jwtAudience"),
    });
  }

  async validate(payload: Partial<AdminTokenPayload>): Promise<AuthenticatedUser> {
    if (payload.scope !== ADMIN_TOKEN_SCOPE || !payload.sub)
      throw new UnauthorizedException("This token is not valid for admin access");
    const admin = await this.admins.findById(payload.sub).lean<any>();
    if (!admin) throw new UnauthorizedException("Admin account not found");
    if ((payload.tv ?? 0) !== (admin.tokenVersion ?? 0))
      throw new UnauthorizedException("Session expired. Please log in again.");
    if (admin.status !== "active")
      throw new UnauthorizedException("This admin account is suspended.");
    const id = admin._id.toString();
    return {
      _id: id,
      id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      status: admin.status,
      permissions: [],
      scopedAshramIds: [],
      scopedTempleIds: [],
    };
  }
}
