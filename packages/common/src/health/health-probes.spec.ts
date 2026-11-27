import { describe, expect, test } from "bun:test";
import { AponiaError } from "../exceptions/aponia-error.ts";
import { compileHealthProbes } from "./health-probes.ts";

describe("health probes", () => {
  test("refuses identical liveness and readiness paths with DUPLICATE_ROUTE", () => {
    let thrown: unknown;
    try {
      compileHealthProbes([], { livenessPath: "/healthz", readinessPath: "/healthz" }, {
        markShuttingDown: () => {},
        isReady: () => true,
      } as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AponiaError);
    expect((thrown as AponiaError).code).toBe("DUPLICATE_ROUTE");
  });
});
