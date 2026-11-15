import { test, expect } from "bun:test";
import { NOOP_LOGGER } from "@aponiajs/common";
import { createHandlers } from "../src/server/devtools-server.ts";
import { handleDevtoolsRequest } from "../src/server/request-router.ts";

const handlers = createHandlers(undefined, undefined, undefined, NOOP_LOGGER);

test("serves the page at the surface root", async () => {
  const response = await handleDevtoolsRequest(
    new Request("http://localhost/__devtools/"),
    handlers,
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");
  const body = await response.text();
  expect(body).toContain("Aponia Devtools");
  expect(body).toContain("./routes");
  expect(body).toContain("./requests");
});

test("serves the page for the bare prefix", async () => {
  const response = await handleDevtoolsRequest(
    new Request("http://localhost/__devtools"),
    handlers,
  );

  expect(response.status).toBe(200);
  expect(await response.text()).toContain("Aponia Devtools");
});
