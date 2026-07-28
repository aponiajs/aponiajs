import { expect, test } from "bun:test";

const entrypoint = await Bun.file(
  new URL("../bin/create-aponia.ts", import.meta.url).pathname,
).text();

test("forwards into the CLI generator without reimplementing it", () => {
  expect(entrypoint).toContain('import { runCli } from "@aponiajs/cli"');
  expect(entrypoint).toContain('runCli(["new", ...Bun.argv.slice(2)])');
  expect(entrypoint).toStartWith("#!/usr/bin/env bun");
});

test("declares the CLI as the dependency that owns the generator", async () => {
  const manifest = (await Bun.file(
    new URL("../package.json", import.meta.url).pathname,
  ).json()) as { readonly dependencies?: Record<string, string> };

  expect(manifest.dependencies?.["@aponiajs/cli"]).toBeDefined();
});
