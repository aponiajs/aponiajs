import {
  Controller,
  Get,
  Inject,
  Injectable,
  LOGGER,
  Module,
  type LoggerService,
} from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");
declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

@Injectable()
class ConformanceLoggingService {
  constructor(@Inject(LOGGER) readonly logger: LoggerService) {}
}

@Controller("conformance-logger")
class ConformanceLoggingController {
  constructor(readonly service: ConformanceLoggingService) {}

  @Get()
  get() {
    this.service.logger.log("conformance-log-line");
    return { ok: true };
  }
}

@Module({
  controllers: [ConformanceLoggingController],
  providers: [ConformanceLoggingService],
})
class ConformanceLoggingModule {}

test("the Vite+ lane resolves @Inject(LOGGER) across the graph", async () => {
  const application = await AponiaFactory.create(ConformanceLoggingModule, { logger: false });
  const service = application.get(ConformanceLoggingService);

  expect(service.logger).toBeDefined();
  expect(typeof service.logger.log).toBe("function");

  const response = await application.handle(new Request("http://localhost/conformance-logger"));
  expect(response.status).toBe(200);

  await application.close();
});
