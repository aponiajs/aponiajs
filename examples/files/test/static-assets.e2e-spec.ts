import { afterAll, beforeAll, expect, test } from "bun:test";
import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";
import { configureStaticAssets } from "../src/static-assets.ts";
import { reservePort } from "./application.ts";

let application: AponiaApplication;

beforeAll(async () => {
  application = await AponiaFactory.create(AppModule, {
    logger: false,
    configureNative: configureStaticAssets,
  });
  await application.listen(await reservePort());
});

afterAll(async () => {
  await application.close();
});

test("serves an asset under the prefix with its own content type", async () => {
  const response = await fetch(`${application.getUrl()}/assets/style.css`);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/css");
});

test("answers a missing asset the way Bun answers, not as Problem Details", async () => {
  const response = await fetch(`${application.getUrl()}/assets/missing.css`);

  expect(response.status).toBe(404);
  expect(response.headers.get("content-type")).toBeNull();
  expect(await response.text()).not.toContain("problem+json");
});

test("a framework route answers beside the native one", async () => {
  const response = await fetch(`${application.getUrl()}/files/download`);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toContain("attachment");
});
