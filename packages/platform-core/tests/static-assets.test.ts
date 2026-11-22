import { describe, expect, test } from "bun:test";
import { answerStaticAsset, normalizeStaticAssets, resolveStaticAssetPath } from "../src/index.ts";

const directory = { prefix: "/assets", root: "./public" };

describe("static assets", () => {
  test("resolves a file under the prefix", () => {
    expect(resolveStaticAssetPath("/assets/app.css", directory)).toBe("./public/app.css");
  });

  test("resolves the directory request to its index", () => {
    expect(resolveStaticAssetPath("/assets", directory)).toBe("./public/index.html");
    expect(resolveStaticAssetPath("/assets/", directory)).toBe("./public/index.html");
    expect(resolveStaticAssetPath("/assets/css/", directory)).toBe("./public/css/index.html");
    expect(resolveStaticAssetPath("/assets/css/", { ...directory, index: "main.html" })).toBe(
      "./public/css/main.html",
    );
  });

  test("leaves a path outside the prefix alone", () => {
    expect(resolveStaticAssetPath("/other/app.css", directory)).toBeUndefined();
    expect(resolveStaticAssetPath("/assetsx/app.css", directory)).toBeUndefined();
  });

  test("refuses traversal, encoded traversal, a backslash, and a NUL", () => {
    expect(resolveStaticAssetPath("/assets/../secret", directory)).toBeUndefined();
    expect(resolveStaticAssetPath("/assets/%2e%2e/secret", directory)).toBeUndefined();
    expect(resolveStaticAssetPath("/assets/..%5csecret", directory)).toBeUndefined();
    expect(resolveStaticAssetPath("/assets/app%00.css", directory)).toBeUndefined();
    expect(resolveStaticAssetPath("/assets/%zz.css", directory)).toBeUndefined();
  });

  test("answers a file with the configured cache policy", async () => {
    const response = await answerStaticAsset(
      "/assets/app.css",
      { ...directory, maxAge: 60 },
      (path) => ({ body: `body:${path}`, exists: true, lastModified: 0 }),
    );

    expect(response?.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response?.headers.get("last-modified")).toBe("Thu, 01 Jan 1970 00:00:00 GMT");
    expect(await response?.text()).toBe("body:./public/app.css");
  });

  test("declines a file that does not exist and a path outside the prefix", async () => {
    const open = () => ({ body: "never", exists: false });
    expect(await answerStaticAsset("/assets/none.css", directory, open)).toBeUndefined();
    expect(await answerStaticAsset("/other/none.css", directory, open)).toBeUndefined();
  });

  test("normalizes one directory or several", () => {
    expect(normalizeStaticAssets(undefined)).toEqual([]);
    expect(normalizeStaticAssets(directory)).toEqual([{ prefix: "/assets", root: "./public" }]);
    expect(normalizeStaticAssets([directory, { prefix: "/", root: "./root" }])).toHaveLength(2);
  });

  test("refuses an invalid declaration", () => {
    for (const invalid of [
      { prefix: 1, root: "./public" },
      { prefix: "/assets", root: "" },
      { prefix: "/assets", root: "./public", index: "" },
      { prefix: "/assets", root: "./public", maxAge: -1 },
      { prefix: "/assets", root: "./public", maxAge: 1.5 },
    ]) {
      expect(() => normalizeStaticAssets(invalid as never)).toThrow(
        expect.objectContaining({ code: "INVALID_CONFIGURATION_VALUE" }),
      );
    }
  });
});
