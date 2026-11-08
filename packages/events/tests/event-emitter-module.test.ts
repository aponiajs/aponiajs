import { afterEach, describe, expect, test } from "bun:test";
import { Module, createToken, provideFactory } from "@aponiajs/common";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { EventEmitter, EventEmitterModule } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("EventEmitterModule", () => {
  test("boots one emitter providers can inject", async () => {
    const observed = createToken<EventEmitter>("observed-emitter");

    @Module({
      imports: [EventEmitterModule.register()],
      providers: [provideFactory(observed, [EventEmitter] as const, (emitter) => emitter)],
      exports: [observed],
    })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });

    expect(application.get(observed)).toBe(application.get(EventEmitter));
  });

  test("keeps a delivered payload on the emitter providers share", async () => {
    @Module({ imports: [EventEmitterModule.register()] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const events = application.get(EventEmitter);
    const seen: unknown[] = [];
    events.on("work", (payload) => {
      seen.push(payload);
    });

    await events.emit("work", { id: 1 });

    expect(seen).toEqual([{ id: 1 }]);
  });
});
