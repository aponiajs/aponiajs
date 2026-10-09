import { describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Inject,
  Injectable,
  LOGGER,
  Module,
  type LoggerService,
} from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { DevtoolsModule } from "../src/index.ts";

@Injectable()
class OrderLogService {
  constructor(@Inject(LOGGER) private readonly logger: LoggerService) {}

  logOrder() {
    this.logger.log("Order #42 placed successfully", "OrderLogService");
    return { orderId: 42 };
  }
}

@Controller("/orders")
class OrderLogController {
  constructor(private readonly service: OrderLogService) {}

  @Get()
  create() {
    return this.service.logOrder();
  }
}

@Module({
  imports: [DevtoolsModule.register({ enabled: true })],
  controllers: [OrderLogController],
  providers: [OrderLogService],
})
class OrderLogAppModule {}

describe("devtools logger seam with observable system logger", () => {
  test("automatically captures boot lines and injected provider log lines without manual logger option", async () => {
    const app = await AponiaFactory.create(OrderLogAppModule);

    // Call endpoint that writes through @Inject(LOGGER)
    const orderRes = await app.handle(new Request("http://localhost/orders"));
    expect(orderRes.status).toBe(200);

    // Read devtools /logs endpoint
    const logsRes = await app.handle(new Request("http://localhost/__devtools/logs"));
    expect(logsRes.status).toBe(200);

    const body = (await logsRes.json()) as {
      levels: string[];
      entries: Array<{ message: string; context: string | null }>;
    };

    expect(body.levels).toContain("log");

    const messages = body.entries.map((e) => e.message);
    // Boot log line
    expect(messages.some((m) => m.includes("Starting Aponia application..."))).toBe(true);
    // Injected service log line
    expect(messages.some((m) => m.includes("Order #42 placed successfully"))).toBe(true);
  });
});
