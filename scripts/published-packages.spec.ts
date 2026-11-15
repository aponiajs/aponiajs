import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";

/**
 * The packages npm serves today, read from the registry on 2026-11-14 with
 * `npm view <name> dist-tags`.
 *
 * Tests may not reach the network, so this list is the checked-in record of what
 * is installable. Publishing a package means adding it here and moving its row
 * from the "Not on npm yet" table to the "On npm today" table in
 * `docs/packages.md` in the same change; the guard fails until both halves move
 * together. The list is not derived from the workspace, because every workspace
 * package exists whether or not a release has shipped it.
 */
const publishedOnNpm = [
  "@aponiajs/cli",
  "@aponiajs/common",
  "@aponiajs/core",
  "@aponiajs/devtools",
  "@aponiajs/platform-elysia",
  "create-aponia",
] as const;

const documentPath = "docs/packages.md";
const publishedHeading = "## On npm today";
const unpublishedHeading = "## Not on npm yet";

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

/** Every workspace package a release would publish. */
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

test("the published table is exactly the packages npm serves", async () => {
  const content = await Bun.file(documentPath).text();
  const stated = sectionPackages(content, publishedHeading);

  expect([...stated].sort()).toEqual([...publishedOnNpm].sort());
});

test("the unpublished table holds every other workspace package", async () => {
  const content = await Bun.file(documentPath).text();
  const published = sectionPackages(content, publishedHeading);
  const unpublished = sectionPackages(content, unpublishedHeading);
  const workspace = await workspacePackages();

  expect(published.filter((name) => unpublished.includes(name))).toEqual([]);
  expect(
    workspace.filter((name) => !published.includes(name) && !unpublished.includes(name)),
  ).toEqual([]);
});

test("no install command names a package npm does not serve", async () => {
  const content = await Bun.file(documentPath).text();
  const commands = [...content.matchAll(/`bun (?:add|create)([^`]*)`/g)].map(
    (match) => match[1] ?? "",
  );
  const named = commands
    .flatMap((command) => [...command.matchAll(/@aponiajs\/[a-z0-9-]+|create-aponia/g)])
    .map((match) => match[0]);

  expect(named.length).toBeGreaterThan(0);
  expect(named.filter((name) => !(publishedOnNpm as readonly string[]).includes(name))).toEqual([]);
});
