import { dirname, join } from "node:path";
import { ValidationPipe, VERSION_NEUTRAL, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import compression from "compression";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module";
import { applyDnsServersFromEnvironment } from "./config/environment";
import { ApiExceptionFilter } from "./common/filters/api-exception.filter";
import { RequestIdInterceptor } from "./common/interceptors/request-id.interceptor";
import { configureDatabase } from "./database/database";
import {
  devRequestLogMiddleware,
  perfEnabled,
  requestPerfMiddleware,
  startEventLoopMonitor,
} from "./common/perf/request-perf";

async function bootstrap(): Promise<void> {
  const isProduction = process.env.NODE_ENV === "production";
  applyDnsServersFromEnvironment();
  // Must run before any model connection exists.
  configureDatabase();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: isProduction,
    // Local runs print only warnings, errors and the ready banner below;
    // NEST_LOG=verbose brings the full Nest startup log back.
    logger: isProduction
      ? undefined
      : process.env.NEST_LOG === "verbose"
        ? ["error", "warn", "log"]
        : ["error", "warn"],
  });
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  if (isProduction) app.useLogger(app.get(Logger));
  app.setGlobalPrefix("api");
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: VERSION_NEUTRAL });
  if (perfEnabled()) {
    app.use(requestPerfMiddleware());
    startEventLoopMonitor();
  }
  if (!isProduction && process.env.REQUEST_LOG !== "false") app.use(devRequestLogMiddleware());
  const adminPanel = config.get<boolean>("adminPanelEnabled") ?? true;
  const apiHelmet = helmet();
  // The admin panel draws OpenStreetMap tiles: they need an image source the API's
  // defaults rule out, and OSM's tile policy needs the Referer that "no-referrer" drops.
  const panelHelmet = helmet({
    contentSecurityPolicy: {
      directives: { "img-src": ["'self'", "data:", "https://tile.openstreetmap.org"] },
    },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });
  app.use((req: Request, res: Response, next: NextFunction) =>
    (adminPanel && /^\/admin(\/|$)/.test(req.path) ? panelHelmet : apiHelmet)(req, res, next),
  );
  app.use(compression());
  if (adminPanel) {
    // Static files only; every call the panel makes goes through the guarded /api routes.
    app.useStaticAssets(join(dirname(require.resolve("leaflet/package.json")), "dist"), {
      prefix: "/admin/vendor/leaflet",
    });
    app.useStaticAssets(join(__dirname, "..", "admin"), { prefix: "/admin" });
  }
  if (config.get<boolean>("trustProxy")) app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Native apps and server-to-server calls send no Origin header.
      if (!origin) return callback(null, true);
      const configured = config.get<string[]>("corsOrigins") ?? [];
      const normalized = origin.trim().replace(/\/+$/, "");
      const allowed =
        configured.map((o) => o.replace(/\/+$/, "")).includes(normalized) ||
        (!isProduction &&
          (/^http:\/\/localhost:[0-9]+$/.test(normalized) || /^http:\/\/127\.0\.0\.1:[0-9]+$/.test(normalized)));
      callback(null, allowed);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Request-Id", "X-Session-Id", "Idempotency-Key"],
    maxAge: 86_400,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());

  if (config.get<boolean>("swaggerEnabled")) {
    const swagger = new DocumentBuilder()
      .setTitle("Movement Tracking API")
      .setDescription(
        "Field agents, leads, attendance and GPS movement tracking.\n\n" +
          "Super Admin: POST /api/auth/login, then send `Authorization: Bearer <token>` to /api/lead-collection/admin/*.\n" +
          "Field agents: POST /api/lead-collection/auth/login, then the agent token on /api/lead-collection/agent/* (supervisors also /supervisor/*).",
      )
      .setVersion("1.0")
      .addBearerAuth()
      .build();
    SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, swagger));
  }

  const port = config.get<number>("port") ?? 5100;
  await app.listen(port, config.get<string>("host") ?? "0.0.0.0");
  const server = app.getHttpServer();
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 185_000;
  server.requestTimeout = 180_000;
  if (!isProduction)
    process.stdout.write(
      `Movement Tracking API ready: http://localhost:${port}/api\n` +
        `Health check: http://localhost:${port}/api/health\n` +
        (adminPanel ? `Admin panel: http://localhost:${port}/admin\n` : "") +
        (config.get<boolean>("swaggerEnabled") ? `API docs: http://localhost:${port}/api/docs\n` : ""),
    );
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`Movement Tracking API failed to start: ${message}\n`);
  process.exitCode = 1;
});
