import { Controller, Get, Header, ServiceUnavailableException } from "@nestjs/common";
import { InjectConnection } from "../database/orm-nest";
import type { Connection } from "../database/orm";
import { LEAD_CONNECTION } from "../modules/lead-collection/domain/lead-collection.constants";
import { Public } from "./decorators/public.decorator";

/** /api/health/live = the process is up; /api/health (= /ready) = the database answers too. */
@Controller("health")
export class HealthController {
  constructor(@InjectConnection(LEAD_CONNECTION) private readonly connection: Connection) {}

  @Public()
  @Get("live")
  @Header("Cache-Control", "no-store")
  live(): Record<string, unknown> {
    return {
      success: true,
      data: { service: "movement-tracking-api", status: "alive", timestamp: new Date().toISOString() },
    };
  }

  @Public()
  @Get()
  @Header("Cache-Control", "no-store")
  status(): Promise<Record<string, unknown>> {
    return this.ready();
  }

  @Public()
  @Get("ready")
  @Header("Cache-Control", "no-store")
  async ready(): Promise<Record<string, unknown>> {
    const checks = { database: false };
    try {
      if (this.connection.readyState === 1) {
        await this.connection.db?.admin().ping();
        checks.database = true;
      }
    } catch {
      checks.database = false;
    }
    const data = {
      service: "movement-tracking-api",
      status: checks.database ? "ready" : "degraded",
      checks,
      timestamp: new Date().toISOString(),
    };
    if (!checks.database)
      throw new ServiceUnavailableException({ message: "Service dependencies are not ready", data });
    return { success: true, data };
  }
}
