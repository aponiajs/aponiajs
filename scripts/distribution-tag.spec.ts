import { describe, expect, test } from "bun:test";
import {
  assertPublishable,
  createCanaryVersion,
  distributionTags,
  isDistributionTag,
  parseVersion,
  resolveDistribution,
} from "./distribution-tag.ts";

describe("distribution tags", () => {
  test("publishes a stable version to latest only", () => {
    expect(resolveDistribution("1.2.3")).toEqual({
      version: "1.2.3",
      tag: "latest",
      aliases: [],
    });
  });

  test("maps every prerelease channel to its own tag", () => {
    expect(resolveDistribution("1.2.3-alpha.1").tag).toBe("alpha");
    expect(resolveDistribution("1.2.3-beta.4").tag).toBe("beta");
    expect(resolveDistribution("1.2.3-rc.2").tag).toBe("rc");
    expect(resolveDistribution("1.2.3-canary.20260727120000.abc1234").tag).toBe("canary");
  });

  test("aliases alpha, beta, and rc to next but never canary", () => {
    expect(resolveDistribution("1.2.3-alpha.1").aliases).toEqual(["next"]);
    expect(resolveDistribution("1.2.3-beta.1").aliases).toEqual(["next"]);
    expect(resolveDistribution("1.2.3-rc.1").aliases).toEqual(["next"]);
    expect(resolveDistribution("1.2.3-canary.20260727120000.abc1234").aliases).toEqual([]);
  });

  test("rejects prerelease identifiers outside the supported channels", () => {
    expect(() => resolveDistribution("1.2.3-dev.1")).toThrow("unsupported prerelease identifier");
  });

  test("rejects versions that are not SemVer", () => {
    expect(() => parseVersion("1.2")).toThrow("not a valid SemVer version");
  });

  test("refuses to publish a prerelease as latest", () => {
    expect(() => assertPublishable("1.2.3-beta.1", "latest")).toThrow(
      "may only be published under: beta, next",
    );
  });

  test("refuses to publish a stable version to a prerelease channel", () => {
    expect(() => assertPublishable("1.2.3", "next")).toThrow("may only be published under: latest");
  });

  test("rejects tags outside the supported set", () => {
    expect(() => assertPublishable("1.2.3", "stable")).toThrow(
      "is not a supported distribution tag",
    );
    expect(distributionTags).toEqual(["latest", "alpha", "beta", "rc", "next", "canary"]);
    expect(isDistributionTag("alpha")).toBe(true);
    expect(isDistributionTag("stable")).toBe(false);
  });

  test("derives a sortable canary version from a commit", () => {
    const canaryVersion = createCanaryVersion(
      "0.4.0",
      "abc1234def5678",
      new Date("2026-07-27T12:30:45Z"),
    );

    expect(canaryVersion).toBe("0.4.0-canary.20260727123045.abc1234");
    expect(resolveDistribution(canaryVersion).tag).toBe("canary");
    expect(Bun.semver.order(canaryVersion, "0.4.0")).toBe(-1);
  });

  test("never derives a canary version from another prerelease channel", () => {
    expect(() => createCanaryVersion("0.4.0-rc.1", "abc1234def5678", new Date())).toThrow(
      "cannot be derived from the rc channel",
    );
  });

  test("rejects a commit identifier that is not a hexadecimal SHA", () => {
    expect(() =>
      createCanaryVersion("0.4.0", "not-a-sha", new Date("2026-07-27T12:30:45Z")),
    ).toThrow("not-a-sha is not a commit SHA.");
  });
});
