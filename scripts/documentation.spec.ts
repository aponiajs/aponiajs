import { describe, expect, test } from "bun:test";

const cliDocumentation = [
  "README.md",
  "docs/cli.md",
  "docs/packages.md",
  "packages/cli/README.md",
] as const;

describe("CLI documentation", () => {
  test("uses the globally installed aponia command consistently", async () => {
    const documents = await Promise.all(cliDocumentation.map((path) => Bun.file(path).text()));

    for (const content of documents) {
      expect(content).not.toContain("bunx aponia");
      expect(content).not.toContain("bun add --dev @aponiajs/cli");
      expect(content).toContain("bun add --global @aponiajs/cli");
    }
  });
});
