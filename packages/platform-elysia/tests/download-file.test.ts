import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  Controller,
  Get,
  Module,
  ResponseSettings,
  type ResponseSettingsState,
} from "@aponiajs/common";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { AponiaFactory, downloadFile, type AponiaApplication } from "../src/index.ts";

/** A settings object shaped like the one the compiled invoker hands a handler. */
function settings(): ResponseSettingsState {
  return { headers: {} };
}

describe("downloadFile", () => {
  test("names an attachment by default, with both name parameters", () => {
    const set = settings();

    downloadFile(set, "/tmp/report.txt", "report.txt");

    expect(set.headers["content-disposition"]).toBe(
      "attachment; filename=\"report.txt\"; filename*=UTF-8''report.txt",
    );
  });

  test("names a render when the caller asks for one", () => {
    const set = settings();

    downloadFile(set, "/tmp/report.txt", "report.txt", { disposition: "inline" });

    expect(set.headers["content-disposition"]).toBe(
      "inline; filename=\"report.txt\"; filename*=UTF-8''report.txt",
    );
  });

  test("encodes a name outside ASCII and keeps the value inside the ASCII range", () => {
    const set = settings();

    downloadFile(set, "/tmp/report.csv", "Ω 2026.csv");

    const value = String(set.headers["content-disposition"]);
    expect(value).toBe("attachment; filename=\"_ 2026.csv\"; filename*=UTF-8''%CE%A9%202026.csv");
    // The engine refuses a value carrying a code point above U+00FF, so the whole
    // header has to stay printable ASCII.
    expect(value).toMatch(/^[\x20-\x7e]+$/);
    const extended = value.slice(value.indexOf("filename*=") + "filename*=".length);
    expect(decodeURIComponent(extended.replace("UTF-8''", ""))).toBe("Ω 2026.csv");
  });

  test("escapes a quote in the fallback and encodes it in the extended value", () => {
    const set = settings();

    downloadFile(set, "/tmp/report.txt", 're"port.txt');

    expect(set.headers["content-disposition"]).toBe(
      'attachment; filename="re\\"port.txt"; filename*=UTF-8\'\'re%22port.txt',
    );
  });

  test("encodes the three characters an extended value cannot carry", () => {
    const set = settings();

    downloadFile(set, "/tmp/report.txt", "a*b'c%d.txt");

    // `'` separates the charset from the value and `%` starts an escape inside an
    // extended value, which is why neither is an attr-char and why the constant
    // that holds the set leaves them out.
    expect(set.headers["content-disposition"]).toBe(
      "attachment; filename=\"a*b'c%d.txt\"; filename*=UTF-8''a%2Ab%27c%25d.txt",
    );
  });

  test("keeps a control character out of the quoted fallback", () => {
    const set = settings();

    downloadFile(set, "/tmp/report.txt", "re\u0001port\u007f.txt");

    const value = String(set.headers["content-disposition"]);
    // A control character is legal in the extended value's percent-encoding and
    // nowhere in a quoted-string, so the fallback replaces it.
    expect(value).toBe("attachment; filename=\"re_port_.txt\"; filename*=UTF-8''re%01port%7F.txt");
    expect(value).toMatch(/^[\x20-\x7e]+$/);
  });

  test("refuses a filename that is a path or carries a control character", () => {
    for (const [filename, reason] of [
      ["reports/2026.csv", "path separator"],
      ["reports\\2026.csv", "path separator"],
      ["reports\n2026.csv", "line feed"],
      ["reports\r2026.csv", "carriage return"],
      ["reports\u00002026.csv", "NUL"],
    ] as const) {
      const set = settings();
      let thrown: unknown;

      try {
        downloadFile(set, "/tmp/report.csv", filename);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(TypeError);
      expect((thrown as TypeError).message).toContain(reason);
      // The refusal happens before the value is built, so nothing is half-written.
      expect(set.headers).toEqual({});
    }
  });
});

const downloadPath = join(tmpdir(), `aponia-download-${process.pid}.txt`);

@Controller("downloads")
class DownloadController {
  @Get()
  read(@ResponseSettings() set: ResponseSettingsState) {
    return downloadFile(set, downloadPath, "Ω 2026.txt");
  }

  @Get("raw")
  readRaw(@ResponseSettings() set: ResponseSettingsState) {
    // What a handler does without the helper: the raw name reaches the engine.
    set.headers["content-disposition"] = 'attachment; filename="Ω 2026.txt"';
    return "raw";
  }
}

@Module({ controllers: [DownloadController] })
class DownloadModule {}

describe("downloading a file through an application", () => {
  let application: AponiaApplication;

  beforeAll(async () => {
    await Bun.write(downloadPath, "measured,at\n1,now\n");
    application = await AponiaFactory.create(DownloadModule, { logger: false });
  });

  afterAll(async () => {
    await application.close();
    await unlink(downloadPath).catch(() => undefined);
  });

  test("streams the file under an encoded name", async () => {
    const response = await application.handle(new Request("http://localhost/downloads"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=\"_ 2026.txt\"; filename*=UTF-8''%CE%A9%202026.txt",
    );
    expect(await response.text()).toBe("measured,at\n1,now\n");
  });

  test("shows the raw value the helper exists to replace being refused", async () => {
    const response = await application.handle(new Request("http://localhost/downloads/raw"));

    // The engine rejects the header value while the response is constructed, so
    // the raw value never reaches a client: Elysia 2 catches that failure where
    // Elysia 1 let it escape `handle` as a TypeError and answers with its own
    // 500 instead. The body says the header is what it refused.
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("content-disposition");
  });
});
