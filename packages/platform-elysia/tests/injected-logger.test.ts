import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Inject,
  Injectable,
  LOGGER,
  Module,
  provideValue,
  type LoggerService,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/application/aponia-factory.ts";
import { inspectAponiaApplication } from "../src/inspection/application-inspection.ts";

@Injectable()
class LoggingService {
  readonly logger: LoggerService;

  constructor(@Inject(LOGGER) logger: LoggerService) {
    this.logger = logger;
  }

  logHello() {
    this.logger.log("Hello from LoggingService", "LoggingService");
    return { ok: true };
  }
}

@Controller("/test-logger")
class LoggingController {
  readonly #service: LoggingService;

  constructor(service: LoggingService) {
    this.#service = service;
  }

  @Get()
  index() {
    return this.#service.logHello();
  }
}

@Module({
  controllers: [LoggingController],
  providers: [LoggingService],
})
class LoggingAppModule {}

describe("injected LOGGER token in platform-elysia", () => {
  test("injects the system logger into a provider across the graph", async () => {
    const loggedLines: string[] = [];
    const customLogger: LoggerService = {
      log: (message) => {
        loggedLines.push(String(message));
      },
      fatal: () => {},
      warn: () => {},
      error: () => {},
    };

    const app = await AponiaFactory.create(LoggingAppModule, { logger: customLogger });
    const response = await app.handle(new Request("http://localhost/test-logger"));

    expect(response.status).toBe(200);
    expect(loggedLines).toContain("Hello from LoggingService");
  });

  test("injects NOOP_LOGGER without throwing when logger: false is configured", async () => {
    const app = await AponiaFactory.create(LoggingAppModule, { logger: false });
    const response = await app.handle(new Request("http://localhost/test-logger"));

    expect(response.status).toBe(200);
  });

  test("injects the default Logger when logger option is omitted", async () => {
    const app = await AponiaFactory.create(LoggingAppModule);
    const service = app.get(LoggingService);

    expect(service.logger).toBeDefined();
    expect(typeof service.logger.log).toBe("function");
  });

  test("local module provider for LOGGER overrides the predefined system logger", async () => {
    const overrideLogger: LoggerService = {
      log: () => {},
      fatal: () => {},
      warn: () => {},
      error: () => {},
    };

    @Module({
      controllers: [LoggingController],
      providers: [LoggingService, provideValue(LOGGER, overrideLogger)],
    })
    class OverrideModule {}

    const app = await AponiaFactory.create(OverrideModule, { logger: false });
    const service = app.get(LoggingService);

    expect(service.logger).toBe(overrideLogger);
  });

  test("inspectAponiaApplication succeeds on modules with @Inject(LOGGER) dependencies", () => {
    const inspection = inspectAponiaApplication(LoggingAppModule);

    expect(inspection.rootModule).toBe("LoggingAppModule");
    expect(inspection.routes.map((r) => r.path)).toContain("/test-logger");
  });
});
