import { describe, expect, test } from "bun:test";
import type { ResponseSettingsState } from "@aponiajs/common";
import { downloadFile } from "../index.ts";

describe("downloadFile", () => {
  test("sets the content-disposition header and returns a file response", async () => {
    const path = `${import.meta.dir}/fixture.txt`;
    await Bun.write(path, "hello");
    const settings: ResponseSettingsState = { headers: {} };

    try {
      const response = downloadFile(settings, path, "café.txt");

      expect(settings.headers["content-disposition"]).toContain("attachment;");
      expect(response.headers.get("content-disposition")).toBeNull();
      expect(settings.headers["content-disposition"]).toContain("filename*=UTF-8''");
      expect(await response.text()).toBe("hello");
    } finally {
      await Bun.file(path).delete();
    }
  });

  test("names an inline render", () => {
    const settings: ResponseSettingsState = { headers: {} };
    downloadFile(settings, `${import.meta.dir}/fixture.txt`, "report.txt", {
      disposition: "inline",
    });

    expect(settings.headers["content-disposition"]).toContain("inline;");
  });
});
