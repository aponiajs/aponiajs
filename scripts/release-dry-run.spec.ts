import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "bun:test";

/**
 * `release:dry-run` packs every publishable workspace and must fail when any one
 * of them fails. The script is the shell loop the root manifest states, so the
 * guard reads that exact command and runs it against a fixture workspace: a
 * temporary root with one minimal package per name the command packs, and one
 * package whose manifest cannot be parsed when a case needs a failure.
 */
const repositoryRoot = resolve(import.meta.dir, "..");
const manifest = (await Bun.file(join(repositoryRoot, "package.json")).json()) as {
  readonly scripts: Readonly<Record<string, string>>;
};
const script = manifest.scripts["release:dry-run"] ?? "";
const packages = script
  .replace(/^.*for package in /, "")
  .replace(/; do[\s\S]*$/, "")
  .trim()
  .split(/\s+/);

interface DryRunResult {
  readonly exitCode: number;
  readonly output: string;
}

async function runDryRun(breakPackage: string | undefined): Promise<DryRunResult> {
  const root = await mkdtemp(join(tmpdir(), "aponia-release-dry-run-"));
  try {
    for (const name of packages) {
      await mkdir(join(root, "packages", name), { recursive: true });
      await Bun.write(
        join(root, "packages", name, "package.json"),
        name === breakPackage
          ? "{not json"
          : `${JSON.stringify({ name: `probe-${name}`, version: "1.0.0" })}\n`,
      );
    }
    await Bun.write(
      join(root, "package.json"),
      `${JSON.stringify(
        { name: "probe", private: true, scripts: { "release:dry-run": script } },
        undefined,
        2,
      )}\n`,
    );

    const child = Bun.spawn(["bun", "run", "release:dry-run"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, output: `${stdout}\n${stderr}` };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("release:dry-run succeeds when every package packs", async () => {
  const result = await runDryRun(undefined);

  expect(result.exitCode).toBe(0);
  expect(result.output).toContain(`probe-${packages.at(-1)}`);
});

test("release:dry-run fails when a package fails, and keeps packing the rest", async () => {
  const failingPackage = "platform-hono";
  const result = await runDryRun(failingPackage);

  expect(result.exitCode).not.toBe(0);
  expect(result.output).toContain(`packages/${failingPackage}`);
  // A failure in the middle must not stop the loop: the last package still packs.
  expect(result.output).toContain(`probe-${packages.at(-1)}`);
});

test("release:dry-run fails when the last package fails", async () => {
  const result = await runDryRun(packages.at(-1));

  expect(result.exitCode).not.toBe(0);
  expect(result.output).toContain(`packages/${packages.at(-1)}`);
});
