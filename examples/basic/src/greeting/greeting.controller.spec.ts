import { describe, expect, test } from "bun:test";
import { GreetingController } from "./greeting.controller.ts";
import { GreetingService } from "./greeting.service.ts";

describe("GreetingController", () => {
  test("returns a greeting from the service", () => {
    const controller = new GreetingController(new GreetingService());

    expect(controller.getGreeting()).toBe("Hello, AponiaJS!");
  });
});
