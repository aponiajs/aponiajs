import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { generateSbom } from "./sbom.ts";

const timestamp = "2026-01-01T00:00:00.000Z";

interface CycloneDxHash {
  readonly alg: string;
  readonly content: string;
}

interface CycloneDxComponent {
  readonly name: string;
  readonly version?: string;
  readonly purl?: string;
  readonly hashes?: readonly CycloneDxHash[];
}

interface CycloneDxDocument {
  readonly bomFormat: string;
  readonly specVersion: string;
  readonly serialNumber: string;
  readonly metadata: {
    readonly timestamp: string;
    readonly component: { readonly name: string; readonly version?: string };
  };
  readonly components: readonly CycloneDxComponent[];
}

function documentOf(text: string): CycloneDxDocument {
  return JSON.parse(text) as CycloneDxDocument;
}

test("states the release and the package inventory in CycloneDX form", async () => {
  const manifest = (await Bun.file(join(import.meta.dir, "..", "package.json")).json()) as {
    readonly version: string;
  };
  const bom = documentOf(await generateSbom({ timestamp }));

  expect(bom.bomFormat).toBe("CycloneDX");
  expect(bom.specVersion).toBe("1.5");
  expect(bom.serialNumber).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
  expect(bom.metadata).toMatchObject({
    timestamp,
    component: { name: "aponiajs-workspace", version: manifest.version },
  });

  const elysia = bom.components.find((component) => component.name === "elysia");
  expect(elysia).toMatchObject({ version: "2.0.0-rc.4", purl: "pkg:npm/elysia@2.0.0-rc.4" });
  // The lockfile integrity travels as a CycloneDX hash: hex, not npm's base64.
  expect(elysia?.hashes?.[0]?.alg).toBe("SHA-512");
  expect(elysia?.hashes?.[0]?.content).toMatch(/^[0-9a-f]{128}$/);

  const common = bom.components.find((component) => component.name === "@aponiajs/common");
  expect(common?.purl).toBe(`pkg:npm/%40aponiajs%2Fcommon@${manifest.version}`);
});

test("produces the same document for the same lockfile", async () => {
  expect(await generateSbom({ timestamp })).toBe(await generateSbom({ timestamp }));
});

test("writes the document where the release lane asks for it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aponia-sbom-"));
  try {
    const outputPath = join(directory, "sbom.cdx.json");
    await generateSbom({ outputPath, timestamp });

    expect(documentOf(await readFile(outputPath, "utf8")).bomFormat).toBe("CycloneDX");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refuses a lockfile that is not JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aponia-sbom-bad-"));
  try {
    const lockfilePath = join(directory, "bun.lock");
    await Bun.write(lockfilePath, "{ not json");
    const failure = await generateSbom({ lockfilePath, timestamp }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(TypeError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reads alias, weaker, and malformed lockfile entries without inventing components", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aponia-sbom-shapes-"));
  try {
    const lockfilePath = join(directory, "bun.lock");
    const manifestPath = join(directory, "package.json");
    const base64 = (bytes: number): string => Buffer.alloc(bytes, 1).toString("base64");
    await Bun.write(
      lockfilePath,
      JSON.stringify({
        workspaces: {
          "": { name: "root" },
          "packages/versioned": { name: "@fixture/versioned", version: "2.0.0" },
          "packages/unversioned": { name: "@fixture/unversioned" },
        },
        packages: {
          weak: ["weak-pkg@1.0.0", "", {}, `sha384-${base64(48)}`],
          older: ["older-pkg@1.0.0", "", {}, `sha1-${base64(20)}`],
          unsupported: ["unknown-hash@1.0.0", "", {}, `crc32-${base64(4)}`],
          unreadable: ["unreadable@1.0.0", "", {}, "bogus"],
          blank: ["blank@", "", {}],
          nonsensical: [42],
          workspace: ["ws@workspace:packages/versioned"],
          separatorless: ["noseparator"],
        },
      }),
    );
    await Bun.write(manifestPath, "{}");

    const bom = documentOf(await generateSbom({ lockfilePath, manifestPath, timestamp }));
    const byName = new Map(bom.components.map((component) => [component.name, component]));

    expect(bom.metadata.component.name).toBe("workspace");
    expect(bom.metadata.component.version).toBeUndefined();
    expect(byName.get("weak-pkg")?.hashes?.[0]?.content).toMatch(/^[0-9a-f]{96}$/);
    expect(byName.get("weak-pkg")?.hashes?.[0]?.alg).toBe("SHA-384");
    expect(byName.get("older-pkg")?.hashes?.[0]?.alg).toBe("SHA-1");
    expect(byName.get("unknown-hash")?.hashes).toBeUndefined();
    expect(byName.get("unreadable")?.hashes).toBeUndefined();
    expect(byName.get("@fixture/versioned")?.purl).toBe("pkg:npm/%40fixture%2Fversioned@2.0.0");
    expect(byName.get("@fixture/unversioned")?.version).toBeUndefined();
    expect(byName.get("@fixture/unversioned")?.purl).toBeUndefined();

    for (const skipped of ["blank", "42", "ws", "noseparator", "broken", "alias", "unknown-hash"]) {
      if (skipped === "unknown-hash") {
        continue;
      }
      expect(byName.has(skipped)).toBe(false);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refuses a lockfile whose content is not an object", async () => {
  const directory = await mkdtemp(join(tmpdir(), "aponia-sbom-null-"));
  try {
    const lockfilePath = join(directory, "bun.lock");
    await Bun.write(lockfilePath, "null");
    const failure = await generateSbom({ lockfilePath, timestamp }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(TypeError);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
