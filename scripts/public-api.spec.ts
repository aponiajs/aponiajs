import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectPublicApi,
  diffSnapshot,
  freezePublicApi,
  parseBarrel,
  readSnapshot,
  runPublicApiEntry,
  verifyPublicApi,
  type PackageSurface,
} from "./public-api.ts";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "aponia-public-api-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterAll(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("public API freeze", () => {
  test("parses every export form a barrel uses", () => {
    const parsed = parseBarrel(`
      export {
        A,
        B as C,
      } from "./x.ts";
      export type { T, U as V } from "./y.ts";
      export { RolesGuard } from "@aponiajs/platform-elysia";
      export interface Shape {}
      export type Alias = string;
      export const value = 1;
      export function fn(): void {}
      export class Klass {}
    `);

    expect(parsed).toEqual([
      { name: "A", kind: "value" },
      { name: "Alias", kind: "type" },
      { name: "C", kind: "value" },
      { name: "fn", kind: "value" },
      { name: "Klass", kind: "value" },
      { name: "RolesGuard", kind: "value" },
      { name: "Shape", kind: "type" },
      { name: "T", kind: "type" },
      { name: "V", kind: "type" },
      { name: "value", kind: "value" },
    ]);
  });

  test("refuses a barrel whose names it cannot enumerate", () => {
    expect(() => parseBarrel('export * from "./x.ts";')).toThrow("cannot be frozen by name");
  });

  test("collects the surface of every published module package", async () => {
    const surfaces = await collectPublicApi();
    const auth = surfaces.find((surface) => surface.name === "@aponiajs/auth");
    const metrics = surfaces.find((surface) => surface.name === "@aponiajs/metrics");

    expect(surfaces.map((surface) => surface.name)).not.toContain("create-aponia");
    expect(auth?.exports).toContainEqual({ name: "AUTH_USER", kind: "value" });
    expect(auth?.exports).toContainEqual({ name: "AuthModuleOptions", kind: "type" });
    expect(metrics?.exports).toContainEqual({ name: "MetricsRegistry", kind: "value" });
  });

  test("describes additions, removals, kind changes, and unpublished packages", () => {
    const surfaces: readonly PackageSurface[] = [
      {
        name: "one",
        exports: [
          { name: "kept", kind: "value" },
          { name: "added", kind: "type" },
        ],
      },
    ];
    const snapshot = {
      contractVersion: 1,
      packages: [
        {
          name: "one",
          exports: [
            { name: "kept", kind: "type" as const },
            { name: "removed", kind: "value" as const },
          ],
        },
        { name: "gone", exports: [] },
      ],
    };

    expect(diffSnapshot(surfaces, snapshot)).toEqual([
      "one: kept changed from a type to a value",
      "one: removed was removed",
      "one: added (type) was added",
      "gone is no longer published",
    ]);
    expect(
      diffSnapshot([...surfaces, { name: "extra", exports: [] }], {
        contractVersion: 1,
        packages: [],
      }),
    ).toEqual(["one is not in the frozen snapshot", "extra is not in the frozen snapshot"]);
  });

  test("freezes, reads, and verifies a snapshot round trip", async () => {
    const directory = await temporaryDirectory();
    const snapshotPath = join(directory, "public-api.json");
    const messages: string[] = [];

    await freezePublicApi({ snapshotPath, log: (message) => messages.push(message) });
    const snapshot = await readSnapshot(snapshotPath);
    await verifyPublicApi({ snapshotPath });
    await runPublicApiEntry({ snapshotPath, log: (message) => messages.push(message) });
    await runPublicApiEntry({
      snapshotPath,
      update: true,
      log: (message) => messages.push(message),
    });

    expect(snapshot.contractVersion).toBe(1);
    expect(snapshot.packages.length).toBeGreaterThan(20);
    expect(messages.some((message) => message.includes("Froze"))).toBe(true);
    expect(messages).toContain("The public API matches docs/public-api.json.");

    const source = await Bun.file(snapshotPath).text();
    await writeFile(
      snapshotPath,
      source.replace('"name": "AUTH_USER"', '"name": "AUTH_USER_RENAMED"'),
    );
    const failure = await verifyFailure(snapshotPath);
    expect(failure).toContain("AUTH_USER_RENAMED was removed");
    expect(failure).toContain("AUTH_USER (value) was added");
    expect(failure).toContain("bun run api:freeze");
  });

  test("refuses a snapshot written for another contract version", async () => {
    const directory = await temporaryDirectory();
    const snapshotPath = join(directory, "public-api.json");
    await writeFile(snapshotPath, JSON.stringify({ contractVersion: 2, packages: [] }));

    expect(readSnapshot(snapshotPath)).rejects.toThrow("is not 1");
  });

  test("the committed snapshot matches the live surface", async () => {
    await verifyPublicApi();
  });
});

async function verifyFailure(snapshotPath: string): Promise<string> {
  try {
    await verifyPublicApi({ snapshotPath });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}
