import { describe, expect, test } from "bun:test";

const parityDoc = await Bun.file("docs/platforms/platform-parity.md").text();

const platformPackages = [
  "@aponiajs/platform-elysia",
  "@aponiajs/platform-hono",
  "@aponiajs/platform-h3",
] as const;

describe("the platform parity page", () => {
  test("names every platform package", () => {
    for (const name of platformPackages) {
      expect(parityDoc).toContain(name);
    }
  });

  test("states what a platform refuses and the code it answers with", () => {
    expect(parityDoc).toContain("UNSUPPORTED_PLATFORM_FEATURE");
    expect(parityDoc).toContain("DUPLICATE_WEBSOCKET_GATEWAY");
    expect(parityDoc).toContain("DUPLICATE_WEBSOCKET_HANDLER");
  });

  test("states the contract every platform shares", () => {
    for (const contract of ["Validation", "Enhancers", "Middleware", "Lifecycle", "Inspection"]) {
      expect(parityDoc).toContain(contract);
    }
  });

  test("the adapters page points at it", async () => {
    const adapters = await Bun.file("docs/platforms/adapters.md").text();

    expect(adapters).toContain("platform-parity.md");
  });
});
