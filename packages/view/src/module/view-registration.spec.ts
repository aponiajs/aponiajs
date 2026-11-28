import { describe, expect, test } from "bun:test";
import { AponiaError, Module } from "@aponiajs/common";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import {
  asyncRegistrationShapeIssues,
  dynamicModuleIssues,
  optionsTokenIssues,
  pluginRegistrationIssues,
  registrationIsolationIssues,
} from "@aponiajs/testing";
import { MODULE_OPTIONS_TOKEN, VIEW_ENGINE, ViewModule, ViewService } from "../index.ts";

describe("ViewModule registration contract", () => {
  test("satisfies the shared registration contract", () => {
    const definition = ViewModule.forRoot({ defaultEngine: "html" });

    expect(pluginRegistrationIssues(ViewModule)).toEqual([]);
    expect(dynamicModuleIssues(definition, ViewModule)).toEqual([]);
    expect(optionsTokenIssues(definition, MODULE_OPTIONS_TOKEN)).toEqual([]);
    expect(definition.id).toBe("ViewModule");
    expect(definition.exports).toContain(ViewService);
  });

  test("is global by default and can opt out", () => {
    expect(ViewModule.forRoot().global).toBe(true);
    expect(ViewModule.forRoot({ isGlobal: false }).global).toBe(false);
    expect(() => ViewModule.forRoot({ isGlobal: 1 as never })).toThrow(AponiaError);
  });

  test("keeps two registrations' identities independent", () => {
    expect(
      registrationIsolationIssues(ViewModule.forRoot(), ViewModule.forRoot(), ViewModule),
    ).toEqual([]);
  });

  test("the register alias delegates to forRoot", () => {
    expect(ViewModule.register({ defaultEngine: "html" }).module).toBe(ViewModule);
  });

  test("accepts the three asynchronous shapes", () => {
    expect(
      asyncRegistrationShapeIssues(
        ViewModule.forRootAsync.bind(ViewModule),
        ViewModule,
        MODULE_OPTIONS_TOKEN,
      ),
    ).toEqual([]);
  });

  test("refuses every invalid option in one refusal", () => {
    const error = capture(() =>
      ViewModule.forRoot({ defaultEngine: "handlebars", cache: "yes" as never }),
    );

    expect(error.code).toBe("INVALID_CONFIGURATION_VALUE");
    expect(error.details).toEqual({
      configuration: "view",
      issues: Object.freeze(['defaultEngine must be "html" or "blade"', "cache must be a boolean"]),
    });
  });

  test("the registerAsync alias delegates to forRootAsync", () => {
    const definition = ViewModule.registerAsync({
      useFactory: () => ({ defaultEngine: "html" }),
    });

    expect(definition.module).toBe(ViewModule);
  });

  test("refuses a root directory, engine, and shared data of the wrong shape", () => {
    const cases: readonly [string, () => unknown][] = [
      ["rootDir must be a string", () => ViewModule.forRoot({ rootDir: 1 as never })],
      ["engine must implement render()", () => ViewModule.forRoot({ engine: {} as never })],
      ["shared must be an object", () => ViewModule.forRoot({ shared: "x" as never })],
    ];

    for (const [issue, run] of cases) {
      const error = capture(run);
      expect(error.code).toBe("INVALID_CONFIGURATION_VALUE");
      expect(error.details.issues).toContain(issue);
    }
  });

  test("builds the blade engine a registration names as its default", async () => {
    @Module({ imports: [ViewModule.forRoot({ defaultEngine: "blade", cache: false })] })
    class BladeModule {}

    const application = await AponiaFactory.create(BladeModule, { logger: false });
    try {
      expect(application.get(VIEW_ENGINE)).toBeDefined();
    } finally {
      await application.close();
    }
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
