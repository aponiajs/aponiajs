import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { ConsoleLogger, Logger } from "../src/index.ts";

afterEach(() => {
  ConsoleLogger.lastTimestampAt = undefined;
});

describe("ConsoleLogger", () => {
  test("supports default, empty, and cascading log-level policies", () => {
    const defaultLogger = new ConsoleLogger();
    const disabledLogger = new ConsoleLogger({ logLevels: [] });
    const warningLogger = new ConsoleLogger({ logLevels: ["warn"] });

    expect(defaultLogger.isLevelEnabled("verbose")).toBe(true);
    expect(disabledLogger.isLevelEnabled("fatal")).toBe(false);
    expect(warningLogger.isLevelEnabled("fatal")).toBe(true);
    expect(warningLogger.isLevelEnabled("error")).toBe(true);
    expect(warningLogger.isLevelEnabled("warn")).toBe(true);
    expect(warningLogger.isLevelEnabled("log")).toBe(false);
    expect(new Logger()).toBeInstanceOf(ConsoleLogger);
  });

  test.serial("writes every JSON log level to the correct stream with its context", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const stdoutWrite = spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    const stderrWrite = spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
    const now = spyOn(Date, "now").mockReturnValue(1_722_225_600_000);

    try {
      const logger = new ConsoleLogger("Bootstrap", {
        json: true,
        logLevels: ["verbose"],
      });

      logger.setContext("Request");
      logger.log({ ready: true });
      logger.warn("slow", "Override");
      logger.debug("debugging");
      logger.verbose("details");
      logger.resetContext();
      logger.error("failed");
      logger.fatal("stopped");

      const stdoutRecords = stdout.map(parseJsonRecord);
      const stderrRecords = stderr.map(parseJsonRecord);

      expect(stdoutRecords).toEqual([
        {
          level: "log",
          pid: process.pid,
          timestamp: 1_722_225_600_000,
          message: { ready: true },
          context: "Request",
        },
        {
          level: "warn",
          pid: process.pid,
          timestamp: 1_722_225_600_000,
          message: "slow",
          context: "Override",
        },
        {
          level: "debug",
          pid: process.pid,
          timestamp: 1_722_225_600_000,
          message: "debugging",
          context: "Request",
        },
        {
          level: "verbose",
          pid: process.pid,
          timestamp: 1_722_225_600_000,
          message: "details",
          context: "Request",
        },
      ]);
      expect(stderrRecords).toEqual([
        {
          level: "error",
          pid: process.pid,
          timestamp: 1_722_225_600_000,
          message: "failed",
          context: "Bootstrap",
        },
        {
          level: "fatal",
          pid: process.pid,
          timestamp: 1_722_225_600_000,
          message: "stopped",
          context: "Bootstrap",
        },
      ]);
    } finally {
      now.mockRestore();
      stderrWrite.mockRestore();
      stdoutWrite.mockRestore();
    }
  });

  test.serial("formats text values, timestamps, colors, and disabled output", () => {
    const stdout: string[] = [];
    const stdoutWrite = spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    const now = spyOn(Date, "now").mockReturnValue(1_050);

    try {
      ConsoleLogger.lastTimestampAt = 1_000;
      const textLogger = new ConsoleLogger({
        colors: false,
        context: "Worker",
        prefix: "Test",
        timestamp: true,
      });
      function NamedTask(): void {}

      textLogger.log(NamedTask);
      textLogger.log({ nested: { value: 1 } });
      new ConsoleLogger({ colors: true }).log("colored");
      new ConsoleLogger({ logLevels: [] }).fatal("hidden");

      expect(stdout).toHaveLength(3);
      expect(stdout[0]).toContain("[Test]");
      expect(stdout[0]).toContain("LOG [Worker] NamedTask");
      expect(stdout[0]).toContain("+50ms");
      expect(stdout[1]).toContain("{ nested: { value: 1 } }");
      expect(stdout[2]).toContain("\u001B[");
      expect(stdout.join("")).not.toContain("hidden");
    } finally {
      now.mockRestore();
      stdoutWrite.mockRestore();
    }
  });
});

function parseJsonRecord(value: string): unknown {
  return JSON.parse(value.trim()) as unknown;
}
