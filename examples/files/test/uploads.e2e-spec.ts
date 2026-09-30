import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { createApplication, file, form, upload } from "./application.ts";

let application: AponiaElysiaApplication;

beforeAll(async () => {
  application = await createApplication();
});

afterAll(async () => {
  await application.close();
});

describe("uploading a file", () => {
  test("an object schema carries the part to @Body() as a File", async () => {
    // Comfortably above the route's `minSize`, so the part reaches the handler.
    const response = await upload(
      application,
      "/files/single",
      form({ file: file("report.dat", new Uint8Array(2048)) }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "report.dat", size: 2048 });
  });

  test("the part's type comes from its filename, not from the declared one", async () => {
    // Measured on bun 1.4.2 / elysia 2.0.0-beta.19, through raw Elysia as well as through
    // this framework: the multipart parser discards the content type the client
    // declared and maps the filename through a MIME table. `file.type` is therefore
    // a fact about the name the client chose, never about the bytes it sent.
    // The payload clears the route's `minSize`; its bytes are deliberately not a PNG.
    const response = await upload(
      application,
      "/files/single",
      form({ file: file("photo.png", "not a png at all".repeat(100), "text/plain") }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "photo.png", type: "image/png" });
  });

  test('@Body("file") hands over the parsed File directly', async () => {
    const response = await upload(
      application,
      "/files/named",
      form({ file: file("avatar.png", "not really a png", "image/png") }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: "avatar.png",
      size: 16,
      type: "image/png",
    });
  });

  test("t.Files() accepts several parts under one field, in order", async () => {
    const response = await upload(
      application,
      "/files/many",
      form({
        files: [file("one.bin", new Uint8Array([1])), file("two.bin", new Uint8Array([2]))],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 2, names: ["one.bin", "two.bin"] });
  });

  test("t.Form() parses a mixed form beside a file", async () => {
    const response = await upload(
      application,
      "/files/form",
      form({ label: "quarterly", file: file("report.csv", "a,b\n") }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ label: "quarterly", name: "report.csv" });
  });

  test("a part above the declared maxSize is refused before the handler runs", async () => {
    const response = await upload(
      application,
      "/files/single",
      form({ file: file("huge.bin", new Uint8Array(1_048_577)) }),
    );

    expect(response.status).toBe(422);
  });

  test("a part below the declared minSize is refused before the handler runs", async () => {
    const response = await upload(
      application,
      "/files/single",
      form({ file: file("tiny.bin", new Uint8Array(512)) }),
    );

    expect(response.status).toBe(422);
  });

  test("t.File() as the whole body refuses the parsed multipart body", async () => {
    const response = await upload(
      application,
      "/files/top-level",
      form({ file: file("report.txt", "hello") }),
    );

    // The boundary this example exists to write down. Elysia 1 answered its own
    // validation failures as a bare `application/json` payload; under Elysia 2
    // the framework answers every one of them as RFC 9457 Problem Details, so a
    // refused route and a failed route now carry one content type and one shape.
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(await response.json()).toMatchObject({
      type: "validation",
      code: "validation",
      status: 422,
      on: "body",
      detail: expect.stringContaining("Blob"),
    });
  });
});
