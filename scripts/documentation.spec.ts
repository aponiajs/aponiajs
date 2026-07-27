import { describe, expect, test } from "bun:test";
import { updateRoadmapVersion } from "./sync-version-references.ts";

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

describe("roadmap", () => {
  test("declares the workspace version", async () => {
    const [roadmap, manifest] = await Promise.all([
      Bun.file("ROADMAP.md").text(),
      Bun.file("package.json").json() as Promise<{ readonly version: string }>,
    ]);

    expect(roadmap).toContain(`- **Current version:** ${manifest.version}`);
  });

  test("rewrites only the current version line", () => {
    const roadmap = "# Roadmap\n\n- **Current version:** 0.4.0\n- **Runtime:** Bun 1.3.14\n";

    expect(updateRoadmapVersion(roadmap, "0.5.0")).toBe(
      "# Roadmap\n\n- **Current version:** 0.5.0\n- **Runtime:** Bun 1.3.14\n",
    );
  });

  test("fails when the version line is missing", () => {
    expect(() => updateRoadmapVersion("# Roadmap\n", "0.5.0")).toThrow(
      "ROADMAP.md does not declare a current version",
    );
  });
});
