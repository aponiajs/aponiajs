import { expect, test } from "bun:test";

/**
 * The community and release surfaces a repository needs before a reader treats
 * it as maintained. They are files rather than code, so nothing compiles them;
 * a deleted or renamed one is caught here.
 */
const governanceFiles = [
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "ROADMAP.md",
  ".github/pull_request_template.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
] as const;

test("the repository carries its governance files", async () => {
  for (const path of governanceFiles) {
    expect(await Bun.file(path).exists(), path).toBe(true);
  }
});

test("the changelog names the release running", async () => {
  const manifest = (await Bun.file("package.json").json()) as {
    readonly version?: unknown;
  };
  const changelog = await Bun.file("CHANGELOG.md").text();

  expect(typeof manifest.version).toBe("string");
  if (typeof manifest.version !== "string") {
    return;
  }

  expect(changelog).toContain(`## ${manifest.version}`);
});

test("the pull request template names the required gates", async () => {
  const template = await Bun.file(".github/pull_request_template.md").text();

  for (const gate of ["bun run check", "bun run test:coverage", "bun run test:vite-plus"]) {
    expect(template).toContain(gate);
  }
});
