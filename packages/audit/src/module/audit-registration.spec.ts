import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import {
  asyncRegistrationShapeIssues,
  dynamicModuleIssues,
  optionsTokenIssues,
  pluginRegistrationIssues,
  registrationIsolationIssues,
} from "@aponiajs/testing";
import { AuditModule, AuditService, MODULE_OPTIONS_TOKEN } from "../index.ts";

describe("AuditModule registration contract", () => {
  test("satisfies the shared registration contract", () => {
    const definition = AuditModule.forRoot({ maxEntries: 5 });

    expect(pluginRegistrationIssues(AuditModule)).toEqual([]);
    expect(dynamicModuleIssues(definition, AuditModule)).toEqual([]);
    expect(optionsTokenIssues(definition, MODULE_OPTIONS_TOKEN)).toEqual([]);
    expect(definition.id).toBe("AuditModule");
    expect(definition.exports).toContain(AuditService);
  });

  test("keeps two registrations' identities independent", () => {
    expect(
      registrationIsolationIssues(AuditModule.forRoot(), AuditModule.forRoot(), AuditModule),
    ).toEqual([]);
  });

  test("isGlobal reaches the definition when stated", () => {
    expect(AuditModule.forRoot().global).toBe(false);
    expect(AuditModule.forRoot({ isGlobal: true }).global).toBe(true);
    expect(() => AuditModule.forRoot({ isGlobal: "yes" as never })).toThrow(AponiaError);
  });

  test("the register alias delegates to forRoot", () => {
    expect(AuditModule.register({ maxEntries: 2 }).module).toBe(AuditModule);
  });

  test("accepts the three asynchronous shapes", () => {
    expect(
      asyncRegistrationShapeIssues(
        AuditModule.forRootAsync.bind(AuditModule),
        AuditModule,
        MODULE_OPTIONS_TOKEN,
      ),
    ).toEqual([]);
  });

  test("refuses an invalid bound at registration", () => {
    const error = capture(() => AuditModule.forRoot({ maxEntries: 0 }));

    expect(error.code).toBe("INVALID_AUDIT_OPTIONS");
    expect(error.details.issues).toEqual(["maxEntries must be a positive integer"]);
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
