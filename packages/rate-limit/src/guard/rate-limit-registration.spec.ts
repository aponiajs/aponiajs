import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import {
  asyncRegistrationShapeIssues,
  dynamicModuleIssues,
  optionsTokenIssues,
  pluginRegistrationIssues,
  registrationIsolationIssues,
} from "@aponiajs/testing";
import {
  MODULE_OPTIONS_TOKEN,
  RateLimitGuard,
  RateLimitModule,
  RateLimitService,
} from "../index.ts";

describe("RateLimitModule registration contract", () => {
  test("satisfies the shared registration contract", () => {
    const definition = RateLimitModule.forRoot({ limit: 10 });

    expect(pluginRegistrationIssues(RateLimitModule)).toEqual([]);
    expect(dynamicModuleIssues(definition, RateLimitModule)).toEqual([]);
    expect(optionsTokenIssues(definition, MODULE_OPTIONS_TOKEN)).toEqual([]);
    expect(definition.id).toBe("RateLimitModule");
    expect(definition.exports).toContain(RateLimitService);
    expect(definition.exports).toContain(RateLimitGuard);
  });

  test("keeps two registrations' identities independent", () => {
    expect(
      registrationIsolationIssues(
        RateLimitModule.forRoot({ limit: 1 }),
        RateLimitModule.forRoot({ limit: 2 }),
        RateLimitModule,
      ),
    ).toEqual([]);
  });

  test("isGlobal defaults to false and reaches the definition when stated", () => {
    expect(RateLimitModule.forRoot().global).toBe(false);
    expect(RateLimitModule.forRoot({ isGlobal: true }).global).toBe(true);
    expect(() => RateLimitModule.forRoot({ isGlobal: 1 as never })).toThrow(AponiaError);
  });

  test("the register alias delegates to forRoot", () => {
    expect(RateLimitModule.register({ limit: 3 }).module).toBe(RateLimitModule);
    expect(() => RateLimitModule.register({ limit: 0 })).toThrow(AponiaError);
  });

  test("accepts the three asynchronous shapes and the extras", () => {
    expect(
      asyncRegistrationShapeIssues(
        RateLimitModule.forRootAsync.bind(RateLimitModule),
        RateLimitModule,
        MODULE_OPTIONS_TOKEN,
      ),
    ).toEqual([]);
    expect(
      RateLimitModule.forRootAsync({ useFactory: async () => ({ limit: 9 }), isGlobal: true })
        .global,
    ).toBe(true);
  });

  test("refuses every invalid option in one refusal", () => {
    const error = capture(() => RateLimitModule.forRoot({ limit: 0, windowMs: -1, maxKeys: 0 }));

    expect(error.code).toBe("INVALID_RATE_LIMIT");
    expect(error.details.issues).toEqual([
      "limit must be a positive integer",
      "windowMs must be a positive integer",
      "maxKeys must be a positive integer",
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
