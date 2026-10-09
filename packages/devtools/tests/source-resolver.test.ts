import { describe, expect, test } from "bun:test";
import { resolveSourceCode } from "../src/source/source-resolver.ts";
import { resolve } from "node:path";

describe("source-resolver", () => {
  test("resolves class source code and line numbers", async () => {
    const fixturePath = resolve(import.meta.dir, "fixtures/sample-source.ts");
    const result = await resolveSourceCode("SampleTargetService", {
      sourceFiles: [fixturePath],
    });

    expect(result).toBeDefined();
    expect(result?.filePath).toBe(fixturePath);
    expect(result?.code).toContain("export class SampleTargetService");
    expect(result?.code).toContain("sayHello()");
    expect(result?.lineStart).toBeGreaterThan(0);
    expect(result?.lineEnd).toBeGreaterThanOrEqual(result!.lineStart);
  });

  test("resolves method source code for a specific controller method", async () => {
    const fixturePath = resolve(import.meta.dir, "fixtures/sample-source.ts");
    const result = await resolveSourceCode("SampleTargetController.greet", {
      sourceFiles: [fixturePath],
    });

    expect(result).toBeDefined();
    expect(result?.filePath).toBe(fixturePath);
    expect(result?.code).toContain("greet()");
    expect(result?.code).toContain('return "hello";');
    expect(result?.lineStart).toBeGreaterThan(0);
  });

  test("returns undefined for unknown targets gracefully", async () => {
    const fixturePath = resolve(import.meta.dir, "fixtures/sample-source.ts");
    const result = await resolveSourceCode("NonExistentTarget", {
      sourceFiles: [fixturePath],
    });

    expect(result).toBeUndefined();
  });
});
