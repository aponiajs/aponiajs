import { expect, test } from "bun:test";
import { AponiaError, type ConfigurationToken } from "@aponiajs/common";
import type { OpentelemetryConfiguration } from "../interfaces/opentelemetry-tracing.interface.ts";
import {
  createOpentelemetryHook,
  readOpentelemetryPolicy,
  type OpentelemetryPolicy,
} from "./opentelemetry.policy.ts";

/**
 * The configuration reader and the request hook's own decisions. The reader is
 * the boundary between a validated configuration and the policy the hook runs,
 * so every refusal is asserted by code and issue list rather than by message,
 * and every default is asserted as the value the hook then runs with. The hook
 * cases drive it with the values a real boot cannot produce — a downstream
 * failure and a body that refuses to be read.
 */

const configuration = {
  description: "opentelemetry.test.reader",
} as unknown as ConfigurationToken<OpentelemetryConfiguration>;

function policyOf(value: unknown): OpentelemetryPolicy {
  return readOpentelemetryPolicy(value, configuration);
}

function issuesOf(value: unknown): readonly string[] {
  try {
    policyOf(value);
  } catch (error) {
    expect(error).toBeInstanceOf(AponiaError);
    expect((error as AponiaError).code).toBe("INVALID_CONFIGURATION_VALUE");
    return (error as AponiaError).details?.issues as readonly string[];
  }
  throw new Error("the reader accepted a value it should have refused");
}

const policy: OpentelemetryPolicy = {
  serviceName: "aponia-hook",
  recordBody: { request: true, response: true },
  headersToSpanAttributes: { request: ["x-request"], response: ["x-response"] },
  spanUrlRedaction: { stripCredentials: true, sensitiveQueryParams: [] },
};

test("reads a minimal configuration into the defaults the hook runs with", () => {
  expect(policyOf({ serviceName: "aponia" })).toEqual({
    serviceName: "aponia",
    recordBody: { request: false, response: false },
    headersToSpanAttributes: { request: [], response: [] },
    spanUrlRedaction: { stripCredentials: true, sensitiveQueryParams: [] },
  });
});

test("reads the boolean shorthand and keeps the header names it was given", () => {
  expect(
    policyOf({
      serviceName: "aponia",
      recordBody: true,
      headersToSpanAttributes: { request: ["x-trace"], response: undefined },
    }),
  ).toMatchObject({
    recordBody: { request: true, response: true },
    headersToSpanAttributes: { request: ["x-trace"], response: [] },
  });
});

test("refuses a header list that names an empty or non-string header", () => {
  expect(
    issuesOf({ serviceName: "aponia", headersToSpanAttributes: { request: ["x-trace", ""] } }),
  ).toHaveLength(1);
  expect(
    issuesOf({ serviceName: "aponia", headersToSpanAttributes: { request: [42] } }),
  ).toHaveLength(1);
});

test("reads a partial body policy field by field", () => {
  expect(policyOf({ serviceName: "aponia", recordBody: { response: true } })).toMatchObject({
    recordBody: { request: false, response: true },
  });
});

test("reads redaction off as the literal it is", () => {
  expect(policyOf({ serviceName: "aponia", spanUrlRedaction: false })).toMatchObject({
    spanUrlRedaction: false,
  });
});

test("refuses a value that is not an object at all", () => {
  for (const value of [null, undefined, "aponia", ["aponia"]]) {
    expect(issuesOf(value)).toHaveLength(1);
  }
});

test("refuses every invalid field rather than the first, naming each one", () => {
  expect(
    issuesOf({
      serviceName: "",
      recordBody: "yes",
      headersToSpanAttributes: "x-trace",
      spanUrlRedaction: 42,
    }),
  ).toEqual([
    '"serviceName" must be a non-empty string',
    '"recordBody" must be a boolean or an object of booleans when it is present',
    '"headersToSpanAttributes" must be an object whose "request" and "response" are lists of non-empty header names when it is present',
    '"spanUrlRedaction" must be false or an object of redaction settings when it is present',
  ]);
});

test("refuses a request body recorded beside a captured credential header", () => {
  expect(
    issuesOf({
      serviceName: "aponia",
      recordBody: true,
      headersToSpanAttributes: { request: ["x-trace", "Authorization"] },
    }),
  ).toEqual([
    '"recordBody" cannot record the request while "headersToSpanAttributes.request" captures "Authorization": both are recorded on the exported span',
  ]);
});

test("accepts a request body recorded beside a header no credential names", () => {
  expect(
    policyOf({
      serviceName: "aponia",
      recordBody: { request: true },
      headersToSpanAttributes: { request: ["x-trace"] },
    }),
  ).toMatchObject({ recordBody: { request: true } });
});

test("the hook forwards the request and answers the response it received", async () => {
  const hook = createOpentelemetryHook({}, policy);
  const request = new Request("http://localhost/users?token=abc");
  const expected = new Response("ok", { status: 201 });

  const response = await hook.wrap!(request, async (passed) => {
    expect(passed).toBe(request);
    return expected;
  });

  expect(response).toBe(expected);
});

test("the hook records a downstream failure and rethrows it unchanged", async () => {
  const hook = createOpentelemetryHook({}, policy);
  const failure = new Error("downstream failed");

  let caught: unknown;
  try {
    await hook.wrap!(new Request("http://localhost/users"), async () => {
      throw failure;
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(failure);
});

test("the hook records a non-Error failure and rethrows it unchanged", async () => {
  const hook = createOpentelemetryHook({}, policy);
  const failure = { reason: "not an error" };

  let caught: unknown;
  try {
    await hook.wrap!(new Request("http://localhost/users"), async () => {
      throw failure;
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(failure);
});

test("a request body that refuses to be read still reaches the handler", async () => {
  const hook = createOpentelemetryHook({}, policy);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error("the body was cut"));
    },
  });
  const request = new Request("http://localhost/users", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);

  let reached = false;
  const response = await hook.wrap!(request, async () => {
    reached = true;
    return new Response("handled");
  });

  expect(reached).toBe(true);
  expect(await response.text()).toBe("handled");
});
