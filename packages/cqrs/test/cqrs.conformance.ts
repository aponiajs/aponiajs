import { describe, expect, test } from "vite-plus/test";
import { Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { CommandBus, CommandHandler, CqrsModule, type ICommandHandler } from "@aponiajs/cqrs";

class PingCommand {}

@CommandHandler(PingCommand)
class PingHandler implements ICommandHandler<PingCommand, string> {
  execute(): string {
    return "pong";
  }
}

describe("@aponiajs/cqrs conformance", () => {
  test("discovers and executes command handlers through CqrsModule", async () => {
    @Module({
      imports: [CqrsModule],
      providers: [PingHandler],
    })
    class AppModule {}

    const app = await AponiaFactory.createApplicationContext(AppModule, { logger: false });
    try {
      expect(await app.get(CommandBus).execute(new PingCommand())).toBe("pong");
    } finally {
      await app.close();
    }
  });
});
