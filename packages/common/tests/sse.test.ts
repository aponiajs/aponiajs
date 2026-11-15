import { describe, expect, test } from "bun:test";
import { Sse, isSseRoute } from "../src/index.ts";

describe("@Sse", () => {
  test("records a controller and a method SSE marker", () => {
    class Controller {
      events(): string {
        return "events";
      }
    }

    Sse()(Controller);
    Sse()(
      Controller.prototype,
      "events",
      Object.getOwnPropertyDescriptor(Controller.prototype, "events")!,
    );

    expect(isSseRoute(Controller)).toBe(true);
    expect(isSseRoute(Controller.prototype, "events")).toBe(true);
    expect(isSseRoute(Controller.prototype, "missing")).toBe(false);
  });
});
