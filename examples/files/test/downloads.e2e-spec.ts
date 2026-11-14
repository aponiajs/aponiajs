import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { AponiaApplication } from "@aponiajs/platform-elysia";
import { createApplication, get } from "./application.ts";

const reportPath = resolve(import.meta.dir, "../data/measurements.csv");
let application: AponiaApplication;
let report: string;

beforeAll(async () => {
  application = await createApplication();
  report = await Bun.file(reportPath).text();
});

afterAll(async () => {
  await application.close();
});

test("a download names itself and streams the file", async () => {
  const response = await get(application, "/files/download");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toBe(
    "attachment; filename=\"measurements.csv\"; filename*=UTF-8''measurements.csv",
  );
  expect(await response.text()).toBe(report);
});

test("a name outside ASCII is encoded, and the header stays ASCII", async () => {
  const response = await get(application, "/files/download/named");

  const value = String(response.headers.get("content-disposition"));
  expect(response.status).toBe(200);
  expect(value).toBe("inline; filename=\"_ 2026.csv\"; filename*=UTF-8''%CE%A9%202026.csv");
  expect(value).toMatch(/^[\x20-\x7e]+$/);
  expect(await response.text()).toBe(report);
});
