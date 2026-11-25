import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import {
  asyncRegistrationShapeIssues,
  dynamicModuleIssues,
  optionsTokenIssues,
  pluginRegistrationIssues,
  registrationIsolationIssues,
} from "@aponiajs/testing";
import { MODULE_OPTIONS_TOKEN, TenantGuard, TenantModule, TenantService } from "./index.ts";

describe("TenantModule registration contract", () => {
  test("satisfies the shared registration contract", () => {
    const definition = TenantModule.forRoot({ header: "x-tenant-id" });

    expect(pluginRegistrationIssues(TenantModule)).toEqual([]);
    expect(dynamicModuleIssues(definition, TenantModule)).toEqual([]);
    expect(optionsTokenIssues(definition, MODULE_OPTIONS_TOKEN)).toEqual([]);
    expect(definition.id).toBe("TenantModule");
    expect(definition.exports).toContain(TenantService);
    expect(definition.exports).toContain(TenantGuard);
  });

  test("keeps two registrations' identities independent", () => {
    expect(
      registrationIsolationIssues(
        TenantModule.forRoot({ header: "x-tenant-id" }),
        TenantModule.forRoot({ header: "x-tenant-id" }),
        TenantModule,
      ),
    ).toEqual([]);
  });

  test("isGlobal reaches the definition when stated", () => {
    expect(TenantModule.forRoot({ header: "x-tenant-id" }).global).toBe(false);
    expect(TenantModule.forRoot({ header: "x-tenant-id", isGlobal: true }).global).toBe(true);
    expect(() => TenantModule.forRoot({ header: "x", isGlobal: "yes" as never })).toThrow(
      AponiaError,
    );
  });

  test("the register alias delegates to forRoot", () => {
    expect(TenantModule.register({ header: "x-tenant-id" }).module).toBe(TenantModule);
  });

  test("accepts the three asynchronous shapes", () => {
    expect(
      asyncRegistrationShapeIssues(
        TenantModule.forRootAsync.bind(TenantModule),
        TenantModule,
        MODULE_OPTIONS_TOKEN,
      ),
    ).toEqual([]);
  });

  test("refuses a registration that states no tenant source", () => {
    const error = capture(() => TenantModule.forRoot());

    expect(error.code).toBe("INVALID_TENANCY_OPTIONS");
    expect(error.details.issues).toEqual([
      "one of header, resolver, or principal must be provided",
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
