import { describe, expect, test } from "bun:test";
import { resolveSourceCode } from "../src/source/source-resolver.ts";
import { resolve } from "node:path";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  test("includes decorators and survives unreadable files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aponia-source-resolver-"));
    try {
      await mkdir(join(directory, "src"), { recursive: true });
      const fixture = join(directory, "src", "decorated.ts");
      await Bun.write(
        fixture,
        `@Controller("x")\nclass DecoratedService {\n  @Get()\n  read(): string {\n    return "x";\n  }\n\n  missing(): string {\n    return "x";\n  }\n}\n`,
      );

      const method = await resolveSourceCode("DecoratedService.read", {
        sourceFiles: [join(directory, "missing.ts"), fixture],
      });
      expect(method?.code).toContain("@Get()");

      const unknownMethod = await resolveSourceCode("DecoratedService.none", {
        sourceFiles: [fixture],
      });
      expect(unknownMethod).toBeUndefined();

      const discovered = await resolveSourceCode("DecoratedService", { cwd: directory });
      expect(discovered?.filePath).toBe(fixture);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
