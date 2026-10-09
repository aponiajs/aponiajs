import { describe, expect, test } from "bun:test";
import { assertReleaseBranch, releaseBranchTags } from "./release-branch.ts";

describe("release branches", () => {
  test("maps every persistent release branch to one primary distribution tag", () => {
    expect(releaseBranchTags).toEqual({
      main: "latest",
      "release/alpha": "alpha",
      "release/beta": "beta",
      "release/rc": "rc",
    });
  });

  test("accepts a version only on its matching release branch", () => {
    expect(assertReleaseBranch("main", "1.2.3")).toBe("latest");
    expect(assertReleaseBranch("release/alpha", "1.2.3-alpha.4")).toBe("alpha");
    expect(assertReleaseBranch("release/beta", "1.2.3-beta.2")).toBe("beta");
    expect(assertReleaseBranch("release/rc", "1.2.3-rc.1")).toBe("rc");
  });

  test("rejects cross-channel releases", () => {
    expect(() => assertReleaseBranch("main", "1.2.3-alpha.1")).toThrow(
      'Branch "main" publishes "latest"',
    );
    expect(() => assertReleaseBranch("release/alpha", "1.2.3-beta.1")).toThrow(
      'version 1.2.3-beta.1 resolves to "beta"',
    );
  });

  test("keeps aliases and ephemeral canaries branchless", () => {
    expect(() => assertReleaseBranch("release/next", "1.2.3-alpha.1")).toThrow(
      "is not a release branch",
    );
    expect(() =>
      assertReleaseBranch("release/canary", "1.2.3-canary.20260728120000.abc1234"),
    ).toThrow("is not a release branch");
  });
});
