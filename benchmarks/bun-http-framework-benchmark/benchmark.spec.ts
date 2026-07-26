import { describe, expect, test } from "bun:test";
import {
  configureElysiaControl,
  configureUpstreamRunner,
  selectedFrameworks,
  validateBenchmarkRun,
} from "./run.ts";
import { createBenchmarkApplication } from "./aponia.ts";

describe("upstream benchmark integration", () => {
  test("selects only the Aponia and Elysia Bun treatments", () => {
    const source = "const whitelists = <string[]>[]\nconst time = 10";
    const configured = configureUpstreamRunner(source);

    expect(configured).toContain("const whitelists = <string[]>['bun/aponia', 'bun/elysia']");
    expect(selectedFrameworks).toEqual(["bun/aponia", "bun/elysia"]);
  });

  test("fails when the upstream runner contract changes", () => {
    expect(() => configureUpstreamRunner("const time = 10")).toThrow(
      "Expected one upstream whitelist declaration but found 0",
    );
  });

  test("adds the Elysia content type required by the upstream preflight", () => {
    const configured = configureElysiaControl("new Elysia().get('/', 'Hi')");

    expect(configured).toContain("set.headers['content-type'] = 'text/plain'");
    expect(() => configureElysiaControl("new Elysia()")).toThrow(
      "Expected one upstream Elysia ping route but found 0",
    );
  });

  test("rejects incomplete or unsuccessful benchmark data", () => {
    const summary = [
      "| Framework | Runtime | Average | Ping | Query | Body |",
      "| aponia | bun | 1 | 1 | 1 | 1 |",
      "| elysia | bun | 1 | 1 | 1 | 1 |",
    ].join("\n");
    const successfulBlock = [
      "HTTP codes:",
      "1xx - 0, 2xx - 100, 3xx - 0, 4xx - 0, 5xx - 0",
      "others - 0",
      "Throughput:",
    ].join("\n");

    expect(() =>
      validateBenchmarkRun(summary, Array.from({ length: 6 }, () => successfulBlock).join("\n")),
    ).not.toThrow();
    expect(() =>
      validateBenchmarkRun(summary, Array.from({ length: 5 }, () => successfulBlock).join("\n")),
    ).toThrow("Expected six Bombardier HTTP status blocks but found 5");
    expect(() =>
      validateBenchmarkRun(
        summary,
        Array.from({ length: 6 }, (_, index) =>
          index === 5 ? successfulBlock.replace("4xx - 0", "4xx - 100") : successfulBlock,
        ).join("\n"),
      ),
    ).toThrow("Bombardier workload 6 contains unsuccessful responses");
  });

  test("implements every upstream HTTP workload", async () => {
    const application = await createBenchmarkApplication();
    const ping = await application.handle(new Request("http://localhost/"));
    const query = await application.handle(new Request("http://localhost/id/1?name=bun&id=2"));
    const missingName = await application.handle(new Request("http://localhost/id/1?id=2"));
    const body = await application.handle(
      new Request("http://localhost/json", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ hello: "world" }),
      }),
    );

    expect(await ping.text()).toBe("Hi");
    expect(ping.headers.get("content-type")).toContain("text/plain");
    expect(await query.text()).toBe("1 bun");
    expect(query.headers.get("content-type")).toContain("text/plain");
    expect(query.headers.get("x-powered-by")).toBe("benchmark");
    expect(await missingName.text()).toBe("1 ");
    expect(await body.json()).toEqual({ hello: "world" });
    expect(body.headers.get("content-type")).toContain("application/json");

    await application.close();
  });
});
