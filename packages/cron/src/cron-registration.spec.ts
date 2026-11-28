import { describe, expect, test } from "bun:test";
import { AponiaError, createToken } from "@aponiajs/common";
import type { ConfigurationToken } from "@aponiajs/common";
import {
  dynamicModuleIssues,
  optionsTokenIssues,
  pluginRegistrationIssues,
  registrationIsolationIssues,
} from "@aponiajs/testing";
import { CronModule, CronScheduler, MODULE_OPTIONS_TOKEN } from "./index.ts";
import type { CronConfiguration } from "./index.ts";

const configuration = createToken<CronConfiguration>(
  "cron.registration.options",
) as unknown as ConfigurationToken<CronConfiguration>;

describe("CronModule registration contract", () => {
  test("satisfies the shared registration contract", () => {
    const definition = CronModule.forRoot({ configuration });

    expect(pluginRegistrationIssues(CronModule, { asynchronous: false })).toEqual([]);
    expect(dynamicModuleIssues(definition, CronModule)).toEqual([]);
    expect(optionsTokenIssues(definition, MODULE_OPTIONS_TOKEN)).toEqual([]);
    expect(definition.id).toBe("CronModule[cron]");
    expect(definition.exports).toContain(configuration);
    expect(definition.exports).toContain(CronScheduler);
  });

  test("the key names the identity and defaults to cron", () => {
    const first = CronModule.forRoot({ configuration, key: "first" });
    const second = CronModule.forRoot({ configuration, key: "second" });

    expect(first.id).toBe("CronModule[first]");
    expect(second.id).toBe("CronModule[second]");
    expect(registrationIsolationIssues(first, second, CronModule)).toEqual([]);
  });

  test("isGlobal defaults to true and can opt out", () => {
    expect(CronModule.forRoot({ configuration }).global).toBe(true);
    expect(CronModule.forRoot({ configuration, isGlobal: false }).global).toBe(false);
  });

  test("the register alias delegates to forRoot", () => {
    expect(CronModule.register({ configuration }).module).toBe(CronModule);
  });

  test("refuses the asynchronous form and a registration without a token", () => {
    const asyncError = capture(() => CronModule.registerAsync({} as never));
    expect(asyncError.code).toBe("INVALID_CONFIGURATION_VALUE");
    expect(asyncError.details).toEqual({
      configuration: "cron",
      issues: Object.freeze(["registerAsync is not supported"]),
    });

    const missing = capture(() => CronModule.forRoot({} as never));
    expect(missing.code).toBe("INVALID_CONFIGURATION_VALUE");
    expect(missing.details.issues).toEqual(["configuration must be a defineConfiguration token"]);
  });

  test("refuses an empty key", () => {
    expect(capture(() => CronModule.forRoot({ configuration, key: "" })).details.issues).toEqual([
      "key must be a non-empty string",
    ]);
  });

  test("refuses a source, switch, or global flag that states another type", () => {
    expect(
      capture(() => CronModule.forRoot({ configuration, source: "env" as never })).details.issues,
    ).toEqual(["source must be an object when present"]);
    expect(
      capture(() => CronModule.forRoot({ configuration, cronJobs: "yes" as never })).details.issues,
    ).toEqual(["cronJobs must be a boolean"]);
    expect(
      capture(() => CronModule.forRoot({ configuration, timeouts: 1 as never })).details.issues,
    ).toEqual(["timeouts must be a boolean"]);
    expect(
      capture(() => CronModule.forRoot({ configuration, isGlobal: "yes" as never })).details.issues,
    ).toEqual(["isGlobal must be a boolean"]);
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
