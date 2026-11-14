import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";

test("every workspace package has a feature-status row", async () => {
  const document = await Bun.file("docs/feature-status.md").text();
  const directories = await readdir("packages", { withFileTypes: true });
  const packages = directories.filter((entry) => entry.isDirectory());

  for (const entry of packages) {
    const manifest = Bun.file(join("packages", entry.name, "package.json"));
    if (!(await manifest.exists())) {
      continue;
    }
    const name = ((await manifest.json()) as { readonly name?: string }).name;
    if (name === "aponiajs") {
      continue;
    }
    expect(document, name).toContain(`\`${name}\``);
  }
});

test("known gaps name their boundary", async () => {
  const document = await Bun.file("docs/feature-status.md").text();
  for (const gap of [
    "distributed queue brokers",
    "MVC adapters",
    "WebSocket transport",
    "2026-07-28",
  ]) {
    expect(document.toLowerCase()).toContain(gap.toLowerCase());
  }
});
