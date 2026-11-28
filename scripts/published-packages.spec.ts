import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";

/**
 * Every publishable package in the workspace ships under the synchronized
 * `1.0.0` (`latest`) release.
 *
 * Tests may not reach the network, so this guard verifies that
 * `docs/reference/packages.md` lists every publishable workspace package under
 * `## Published packages` and that no install command names a private or
 * non-existent package.
 */
const documentPath = "docs/reference/packages.md";
const publishedHeading = "## Published packages";

/** The package names a section's table states, in document order. */
function sectionPackages(content: string, heading: string): readonly string[] {
  const start = content.indexOf(heading);
  expect(start, `${documentPath}: missing "${heading}"`).toBeGreaterThanOrEqual(0);

  const rest = content.slice(start + heading.length);
  const end = rest.search(/\n## /);
  const section = end === -1 ? rest : rest.slice(0, end);
  const names = [...section.matchAll(/^\|\s*`([^`]+)`/gm)].map((match) => match[1] ?? "");

  expect(names.length, `${documentPath}: "${heading}" states no package`).toBeGreaterThan(0);
  return names;
}

/** Every workspace package a release publishes. */
async function workspacePackages(): Promise<readonly string[]> {
  const directories = await readdir("packages", { withFileTypes: true });
  const names: string[] = [];

  for (const entry of directories) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifest = Bun.file(join("packages", entry.name, "package.json"));
    if (!(await manifest.exists())) {
      continue;
    }
    const name = ((await manifest.json()) as { readonly name?: unknown }).name;
    if (typeof name !== "string" || name === "aponiajs") {
      continue;
    }
    names.push(name);
  }

  return names.sort();
}

test("the published table is exactly the publishable workspace packages", async () => {
  const content = await Bun.file(documentPath).text();
  const stated = sectionPackages(content, publishedHeading);
  const workspace = await workspacePackages();

  expect([...stated].sort()).toEqual([...workspace].sort());
});

test("no install command names a package outside the publishable workspace set", async () => {
  const content = await Bun.file(documentPath).text();
  const workspace = await workspacePackages();
  const commands = [...content.matchAll(/`bun (?:add|create)([^`]*)`/g)].map(
    (match) => match[1] ?? "",
  );
  const named = commands
    .flatMap((command) => [...command.matchAll(/@aponiajs\/[a-z0-9-]+|create-aponia/g)])
    .map((match) => match[0]);

  expect(named.length).toBeGreaterThan(0);
  expect(named.filter((name) => !workspace.includes(name))).toEqual([]);
});
