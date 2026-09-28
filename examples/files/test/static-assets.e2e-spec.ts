import { afterAll, beforeAll, expect, test } from "bun:test";
import { createServer } from "node:net";
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";
import { configureStaticAssets } from "../src/static-assets.ts";

/**
 * A native directory route is Bun's, not Elysia's: it is composed when the server
 * starts, so this suite listens on a reserved ephemeral port instead of driving
 * `handle` the way every other lane does.
 */
async function reservePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  if (!address || typeof address === "string") {
    reservation.close();
    throw new Error("Could not reserve an ephemeral test port.");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

let application: AponiaElysiaApplication;

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
