import { expect, test } from "bun:test";
import { Controller, Get, Injectable, Module, type LoggerService } from "@aponiajs/common";
import { AponiaFactory } from "../src/index.ts";

class MemoryLogger implements LoggerService {
  readonly records: { readonly context: string; readonly message: string }[] = [];

  log(message: unknown, context?: unknown): void {
    this.records.push({
      context: typeof context === "string" ? context : "",
      message: String(message),
    });
  }

  fatal(): void {}

  error(): void {}

  warn(): void {}
}

@Injectable()
class MessageService {
  getMessage(): string {
    return "Hello from service";
  }
}

@Controller("messages")
class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Get()
  getMessage(): string {
    return this.messageService.getMessage();
  }
}

@Module({
  providers: [MessageService],
  exports: [MessageService],
})
class MessageServicesModule {}

@Module({
  imports: [MessageServicesModule],
  controllers: [MessageController],
})
class MessageModule {}

test("imports modules and injects their exported services into controllers", async () => {
  const logger = new MemoryLogger();
  const application = await AponiaFactory.create(MessageModule, { logger });
  const response = await application.handle(new Request("http://localhost/messages"));

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("Hello from service");
  expect(() => application.getUrl()).toThrow(
    "app.listen() needs to be called before calling app.getUrl().",
  );
  expect(logger.records).toEqual([
    {
      context: "AponiaFactory",
      message: "Starting Aponia application...",
    },
    {
      context: "InstanceLoader",
      message: "MessageServicesModule dependencies initialized",
    },
    {
      context: "InstanceLoader",
      message: "MessageModule dependencies initialized",
    },
    {
      context: "RoutesResolver",
      message: "MessageController {/messages}:",
    },
    {
      context: "RouterExplorer",
      message: "Mapped {/messages, GET} route",
    },
  ]);
  await application.close();
});
