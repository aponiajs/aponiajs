import { Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  EventEmitter,
  EVENT_EMITTER_MODULE_OPTIONS,
  EventEmitterModule,
  OnEvent,
  type EventHandler,
} from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("exposes the documented emitter contract", () => {
  const emitter = new EventEmitter();
  const handler: EventHandler<string> = (payload) => {
    expect(payload).toBe("value");
  };
  const unsubscribe = emitter.on("work", handler);

  expect(emitter.listenerCount("work")).toBe(1);
  unsubscribe();
  expect(emitter.listenerCount("work")).toBe(0);
});

test("boots and delivers through the injected emitter", async () => {
  @Module({ imports: [EventEmitterModule.register()] })
  class AppModule {}

  const application = await AponiaFactory.create(AppModule, { logger: false });
  try {
    const events = application.get(EventEmitter);
    const seen: string[] = [];
    events.on("work", (payload: string) => {
      seen.push(payload);
    });

    await events.emit("work", "value");

    expect(seen).toEqual(["value"]);
  } finally {
    await application.close();
  }
});

test("binds a decorated listener", async () => {
  const seen: string[] = [];

  class Listener {
    @OnEvent("work")
    handle(value: string): void {
      seen.push(value);
    }
  }

  const emitter = new EventEmitter();
  const unbind = emitter.bind(new Listener());
  await emitter.emit("work", "value");
  unbind();

  expect(seen).toEqual(["value"]);
});

test("the registration is global and exports the symbol options token", () => {
  const definition = EventEmitterModule.forRoot();

  expect(definition.module).toBe(EventEmitterModule);
  expect(definition.global).toBe(true);
  expect(definition.exports).toContain(EVENT_EMITTER_MODULE_OPTIONS);
});
