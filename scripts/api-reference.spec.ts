import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderApiReference, writeApiReference } from "./build-api-reference.ts";

const snapshot = (await Bun.file("docs/public-api.json").json()) as Parameters<
  typeof renderApiReference
>[0];

const temporaryRoot = await mkdtemp(join(tmpdir(), "aponia-api-reference-"));

afterAll(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("API reference", () => {
  test("lists every package and every exported name", () => {
    const page = renderApiReference(snapshot);

    for (const pkg of snapshot.packages) {
      expect(page).toContain(`## \`${pkg.name}\``);
      for (const entry of pkg.exports) {
        expect(page).toContain(`- \`${entry.name}\` (${entry.kind})`);
      }
    }
  });

  test("is deterministic", () => {
    expect(renderApiReference(snapshot)).toBe(renderApiReference(snapshot));
  });

  test("the committed page is current", async () => {
    expect(await writeApiReference({ check: true })).toBe(0);
  });

  test("check mode reports a stale page and write mode repairs it", async () => {
    const output = join(temporaryRoot, "api.md");
    await Bun.write(output, "stale\n");

    expect(await writeApiReference({ check: true, output })).toBe(1);
    expect(await writeApiReference({ output })).toBe(0);
    expect(await writeApiReference({ check: true, output })).toBe(0);
  });
});
