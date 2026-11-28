import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  checkForUpdatesAndAdvisories,
  compareSemver,
  defaultUpdateCachePath,
  formatUpdateAdvisoryBanner,
  parseSemver,
} from "./update-notifier.ts";

describe("aponia dev update & dangerous-patch notifier", () => {
  it("parses and compares SemVer including prerelease precedence", () => {
    expect(parseSemver("1.0.0-beta.64")).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: ["beta", 64],
    });
    expect(parseSemver("invalid")).toBeUndefined();
    // 1.0.0-beta.64 is newer than 0.5.0 (never recommend downgrade to older latest)
    expect(compareSemver("0.5.0", "1.0.0-beta.64")).toBeLessThan(0);
    expect(compareSemver("1.0.0-beta.65", "1.0.0-beta.64")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "1.0.0-beta.64")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-beta.1")).toBeLessThan(0);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(defaultUpdateCachePath()).toContain("update-check.json");
  });

  it("detects npm updates, deprecations, and OSV dangerous-patch advisories, and caches for 24h", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aponia-update-test-"));
    const cachePath = join(dir, "cache", "update-check.json");
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "sample-app",
          dependencies: {
            "@aponiajs/core": "1.0.0-beta.64",
            elysia: "2.0.0-rc.4",
            "@aponiajs/local": "workspace:*",
          },
        }),
      );

      let fetchCalls = 0;
      const mockFetch = (async (input: string | URL | Request) => {
        fetchCalls += 1;
        const parsedUrl = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        );
        if (
          parsedUrl.hostname === "registry.npmjs.org" &&
          parsedUrl.pathname === "/%40aponiajs%2Fcli"
        ) {
          return new Response(
            JSON.stringify({
              "dist-tags": { latest: "0.5.0", beta: "1.0.0-beta.65" },
              versions: {
                "1.0.0-beta.64": {
                  deprecated: "Critical bug in 1.0.0-beta.64; upgrade immediately",
                },
              },
            }),
            { status: 200 },
          );
        }
        if (
          parsedUrl.hostname === "registry.npmjs.org" &&
          parsedUrl.pathname === "/%40aponiajs%2Fcore"
        ) {
          return new Response(
            JSON.stringify({
              "dist-tags": { latest: "0.5.0", beta: "1.0.0-beta.64" },
            }),
            { status: 200 },
          );
        }
        if (parsedUrl.hostname === "api.osv.dev" && parsedUrl.pathname === "/v1/querybatch") {
          return new Response(
            JSON.stringify({
              results: [
                { vulns: [] },
                { vulns: [] },
                {
                  vulns: [
                    {
                      id: "GHSA-9999-xxxx",
                      summary: "Prototype pollution in elysia",
                      affected: [{ ranges: [{ events: [{ fixed: "2.0.0-rc.5" }] }] }],
                    },
                  ],
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response("not found", { status: 404 });
      }) as unknown as typeof fetch;

      let clock = 10_000;
      const report = await checkForUpdatesAndAdvisories({
        cwd: dir,
        cachePath,
        cliVersion: "1.0.0-beta.64",
        fetch: mockFetch,
        now: () => clock,
      });

      expect(report).toBeDefined();
      expect(report!.updates).toHaveLength(1);
      expect(report!.updates[0]!.packageName).toBe("@aponiajs/cli");
      expect(report!.updates[0]!.latestVersion).toBe("1.0.0-beta.65");
      expect(report!.updates[0]!.deprecated).toContain("Critical bug");
      expect(report!.advisories).toHaveLength(1);
      expect(report!.advisories[0]!.advisoryIds).toEqual(["GHSA-9999-xxxx"]);
      expect(report!.advisories[0]!.fixedVersion).toBe("2.0.0-rc.5");

      const banner = formatUpdateAdvisoryBanner(report!);
      expect(banner).toContain("SECURITY / DANGEROUS PATCH ADVISORY");
      expect(banner).toContain("GHSA-9999-xxxx");
      expect(banner).toContain("upgrade to >= 2.0.0-rc.5");
      expect(banner).toContain("DEPRECATED");

      // Second call within 24h hits cache (no extra fetch calls)
      const callsBefore = fetchCalls;
      clock += 60_000;
      const cached = await checkForUpdatesAndAdvisories({
        cwd: dir,
        cachePath,
        cliVersion: "1.0.0-beta.64",
        fetch: mockFetch,
        now: () => clock,
      });
      expect(cached).toEqual(report);
      expect(fetchCalls).toBe(callsBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails silently when offline or timed out and returns undefined banner when clean", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aponia-offline-test-"));
    const cachePath = join(dir, "cache.json");
    try {
      const offlineFetch = (async () => {
        throw new Error("network unreachable");
      }) as unknown as typeof fetch;

      const report = await checkForUpdatesAndAdvisories({
        cwd: dir,
        cachePath,
        cliVersion: "1.0.0-beta.64",
        fetch: offlineFetch,
      });

      expect(report).toBeDefined();
      expect(report!.updates).toEqual([]);
      expect(report!.advisories).toEqual([]);
      expect(formatUpdateAdvisoryBanner(report!)).toBeUndefined();

      // Stable version update banner + stale cache refresh + malformed package.json
      writeFileSync(join(dir, "package.json"), "{ invalid json");
      writeFileSync(cachePath, JSON.stringify({ checkedAt: 0, report: report! }));
      const stableFetch = (async (input: string | URL | Request) => {
        const parsedUrl = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        );
        if (parsedUrl.hostname === "registry.npmjs.org") {
          return new Response(JSON.stringify({ "dist-tags": { latest: "2.0.0" } }), {
            status: 200,
          });
        }
        return new Response("err", { status: 503 });
      }) as unknown as typeof fetch;

      const updated = await checkForUpdatesAndAdvisories({
        cwd: dir,
        cachePath,
        cliVersion: "1.0.0",
        fetch: stableFetch,
        now: () => 999_999_999,
      });
      expect(updated!.updates).toHaveLength(1);
      const updateBanner = formatUpdateAdvisoryBanner(updated!);
      expect(updateBanner).toContain("1.0.0 -> 2.0.0");

      // Alpha channel + missing package.json directory
      const missingDir = join(dir, "nonexistent");
      const alphaResult = await checkForUpdatesAndAdvisories({
        cwd: missingDir,
        cachePath: join(dir, "alpha-cache.json"),
        cliVersion: "1.0.0-alpha.1",
        fetch: stableFetch,
        now: () => 999_999_999,
      });
      expect(alphaResult!.updates[0]!.latestVersion).toBe("2.0.0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
