import { expect, test } from "bun:test";
import type { LoggerService } from "@aponiajs/common";
import { createLogBuffer, defaultLogBufferCapacity } from "./log-buffer.ts";
import { getTappedLogStream, isRecordableLogger, recordLogger } from "./log-tap.ts";

/**
 * The logger seam: a value is checked before it is trusted, a tap patches in
 * place, and one logger has one stream. These cases own the identity and the
 * refusal half; `logs.spec.ts` owns the payload built from the buffer.
 */

test("isRecordableLogger refuses a value no line could be recorded through", () => {
  expect(isRecordableLogger(null)).toBe(false);
  expect(isRecordableLogger("logger")).toBe(false);
  expect(isRecordableLogger(42)).toBe(false);
  expect(isRecordableLogger({})).toBe(false);
  expect(
    isRecordableLogger({
      log: () => {},
      fatal: () => {},
      error: () => {},
      warn: () => {},
    }),
  ).toBe(true);
});

test("isRecordableLogger answers false for a level that refuses to be read", () => {
  const refusing = new Proxy(
    {},
    {
      get() {
        throw new TypeError("this level cannot be read");
      },
    },
  );

  expect(isRecordableLogger(refusing)).toBe(false);
});

test("recordLogger patches the logger in place and answers one stream per logger", () => {
  const printed: unknown[] = [];
  const logger: LoggerService = {
    log: (message) => printed.push(message),
    fatal: () => {},
    error: () => {},
    warn: () => {},
  };

  expect(getTappedLogStream(logger)).toBeUndefined();

  const buffer = createLogBuffer(defaultLogBufferCapacity);
  const stream = recordLogger(logger, buffer);

  expect(stream?.levels).toEqual(["log", "fatal", "error", "warn"]);
  expect(stream?.buffer).toBe(buffer);
  expect(getTappedLogStream(logger)).toBe(stream);

  logger.log("recorded");
  expect(printed).toEqual(["recorded"]);
  expect(stream?.buffer.since(0).entries.map((entry) => entry.message)).toEqual(["recorded"]);

  // A second tap of one logger answers the stream already recording it rather
  // than stacking a second wrapper that would record and print twice.
  const again = recordLogger(logger, createLogBuffer(defaultLogBufferCapacity));
  expect(again).toBe(stream);

  logger.log("still one line");
  expect(printed).toEqual(["recorded", "still one line"]);
  expect(stream?.buffer.since(0).entries).toHaveLength(2);
});

test("recordLogger answers undefined when the value carries no level to patch", () => {
  expect(
    recordLogger({} as LoggerService, createLogBuffer(defaultLogBufferCapacity)),
  ).toBeUndefined();
});
