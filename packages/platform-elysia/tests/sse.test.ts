import { afterEach, describe, expect, test } from "bun:test";
import { Controller, Get, Module, Sse } from "@aponiajs/common";
import { AponiaFactory, sse, type AponiaApplication } from "../src/index.ts";

let application: AponiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe("@Sse", () => {
  test("sets the event-stream headers and streams the handler payload", async () => {
    @Controller("events")
    class EventsController {
      @Get()
      @Sse()
      async read() {
        return sse(
          (async function* () {
            yield sse({ event: "tick", data: "1" });
          })(),
        );
      }
    }

    @Module({ controllers: [EventsController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(new Request("http://localhost/events"));

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toBe("event: tick\ndata: 1\n\n");
  });

  test("lets a handler-level marker override a controller-level marker", async () => {
    @Controller("mixed")
    @Sse()
    class MixedController {
      @Get("plain")
      plain(): string {
        return "plain";
      }
    }

    @Module({ controllers: [MixedController] })
    class AppModule {}

    application = await AponiaFactory.create(AppModule, { logger: false });
    const response = await application.handle(new Request("http://localhost/mixed/plain"));

    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });
});
