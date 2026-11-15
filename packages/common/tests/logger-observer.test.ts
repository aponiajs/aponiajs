import { describe, expect, test } from "bun:test";
import {
  LOGGER,
  NOOP_LOGGER,
  observeSystemLogger,
  notifySystemLogger,
  type LoggerService,
} from "../src/index.ts";

describe("logger observer and token", () => {
  test("LOGGER token is created with description 'aponia.logger'", () => {
    expect(LOGGER.description).toBe("aponia.logger");
    expect(typeof LOGGER.id).toBe("symbol");
  });

  test("NOOP_LOGGER safely discards all calls", () => {
    expect(() => {
      NOOP_LOGGER.log("test", "Context");
      NOOP_LOGGER.fatal("error", "Context");
      NOOP_LOGGER.warn("warning", "Context");
      NOOP_LOGGER.error("err", "Context");
    }).not.toThrow();
  });

  test("observeSystemLogger receives notified logger and unsubscribe stops notifications", () => {
    const received: LoggerService[] = [];
    const unsubscribe = observeSystemLogger((logger) => {
      received.push(logger);
    });

    const mockLogger: LoggerService = {
      log: () => {},
      fatal: () => {},
      warn: () => {},
      error: () => {},
    };

    notifySystemLogger(mockLogger);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(mockLogger);

    unsubscribe();
    notifySystemLogger(mockLogger);
    expect(received).toHaveLength(1);
  });
});
