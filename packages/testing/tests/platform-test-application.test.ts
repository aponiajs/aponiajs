import { expect, test } from "bun:test";
import { Controller, Get, Injectable, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-hono";
import { wrapPlatformApplication, type TestableApplication } from "../src/index.ts";

@Injectable()
class Greeting {
  greet(): string {
    return "hello";
  }
}

@Controller("greetings")
class GreetingController {
  constructor(private readonly greeting: Greeting) {}

  @Get()
  index(): { readonly message: string } {
    return { message: this.greeting.greet() };
  }
}

@Module({ controllers: [GreetingController], providers: [Greeting] })
class AppModule {}

test("wraps any platform's boot in the shared teardown contract", async () => {
  const application = wrapPlatformApplication(
    await AponiaFactory.create(AppModule, { logger: false }),
  );

  const response = await application.handle(new Request("http://localhost/greetings"));
  expect(await response.json()).toEqual({ message: "hello" });
  expect(application.get(Greeting)).toBeInstanceOf(Greeting);

  await application.close();
  await application.close();
  expect(true).toBe(true);
});

test("disposes a boot at the end of its scope", async () => {
  let closed = 0;
  const fake = {
    handle: () => Promise.resolve(new Response("ok")),
    get: () => 1,
    close: async () => {
      closed += 1;
    },
  } as unknown as TestableApplication;

  {
    await using application = wrapPlatformApplication(fake);
    expect(await application.handle(new Request("http://localhost/"))).toBeInstanceOf(Response);
  }

  expect(closed).toBe(1);
});
