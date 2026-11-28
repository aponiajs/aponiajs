import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import {
  asyncRegistrationShapeIssues,
  dynamicModuleIssues,
  optionsTokenIssues,
  pluginRegistrationIssues,
  registrationIsolationIssues,
} from "@aponiajs/testing";
import { MODULE_OPTIONS_TOKEN, OutboxService, QueueModule, QueueService } from "./index.ts";

describe("QueueModule registration contract", () => {
  test("satisfies the shared registration contract", () => {
    const definition = QueueModule.forRoot({ queue: { concurrency: 2 } });

    expect(pluginRegistrationIssues(QueueModule)).toEqual([]);
    expect(dynamicModuleIssues(definition, QueueModule)).toEqual([]);
    expect(optionsTokenIssues(definition, MODULE_OPTIONS_TOKEN)).toEqual([]);
    expect(definition.id).toBe("QueueModule");
    expect(definition.exports).toContain(QueueService);
    expect(definition.exports).toContain(OutboxService);
  });

  test("keeps two registrations' identities independent", () => {
    expect(
      registrationIsolationIssues(QueueModule.forRoot(), QueueModule.forRoot(), QueueModule),
    ).toEqual([]);
  });

  test("isGlobal reaches the definition when stated", () => {
    expect(QueueModule.forRoot().global).toBe(false);
    expect(QueueModule.forRoot({ isGlobal: true }).global).toBe(true);
    expect(() => QueueModule.forRoot({ isGlobal: "yes" as never })).toThrow(AponiaError);
  });

  test("the register alias delegates to forRoot", () => {
    expect(QueueModule.register({ queue: { concurrency: 1 } }).module).toBe(QueueModule);
  });

  test("accepts the three asynchronous shapes", () => {
    expect(
      asyncRegistrationShapeIssues(
        QueueModule.forRootAsync.bind(QueueModule),
        QueueModule,
        MODULE_OPTIONS_TOKEN,
      ),
    ).toEqual([]);
  });

  test("fails fast on malformed queue options and reports every issue", () => {
    const error = capture(() =>
      QueueModule.forRoot({
        queue: { concurrency: 0, maxAttempts: -1, store: {} as never },
        outbox: { maxEntries: 0, store: {} as never },
      }),
    );

    expect(error.code).toBe("INVALID_QUEUE_OPTIONS");
    expect(error.details.issues).toEqual([
      "concurrency must be a positive integer",
      "maxAttempts must be a positive integer",
      "store is missing load, save, remove, clear",
      "outbox.maxEntries must be a positive integer",
      "outbox.store is missing list, append, update, remove, clear",
    ]);
  });
});

function capture(run: () => unknown): AponiaError {
  try {
    run();
  } catch (error) {
    if (error instanceof AponiaError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected an AponiaError.");
}
