import { describe, expect, test } from "bun:test";
import { installShutdownSignalHandlers } from "./shutdown-signals.ts";

describe("installShutdownSignalHandlers", () => {
  test("installs listeners for requested signals and re-raises after teardown", async () => {
    const listeners = new Map<string, () => void>();
    const killed: string[] = [];
    let closed = 0;
    const target = {
      pid: 1234,
      on(signal: "SIGTERM" | "SIGINT", listener: () => void) {
        listeners.set(signal, listener);
      },
      off(signal: "SIGTERM" | "SIGINT") {
        listeners.delete(signal);
      },
      kill(_pid: number, signal: "SIGTERM" | "SIGINT") {
        killed.push(signal);
      },
    };

    installShutdownSignalHandlers(
      async () => {
        closed += 1;
      },
      undefined,
      target,
    );

    listeners.get("SIGTERM")?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(closed).toBe(1);
    expect(killed).toEqual(["SIGTERM"]);
  });

  test("reports teardown failures to logger and still re-raises the signal", async () => {
    const listeners = new Map<string, () => void>();
    const killed: string[] = [];
    const errors: unknown[] = [];
    const target = {
      pid: 1234,
      on(signal: "SIGTERM" | "SIGINT", listener: () => void) {
        listeners.set(signal, listener);
      },
      off(signal: "SIGTERM" | "SIGINT") {
        listeners.delete(signal);
      },
      kill(_pid: number, signal: "SIGTERM" | "SIGINT") {
        killed.push(signal);
      },
    };

    installShutdownSignalHandlers(
      async () => {
        throw new Error("stop failed");
      },
      {
        log() {},
        error(message: unknown) {
          errors.push(message);
        },
        warn() {},
        fatal() {},
      },
      target,
    );

    listeners.get("SIGINT")?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(errors.length).toBe(1);
    expect(killed).toEqual(["SIGINT"]);
  });
});
