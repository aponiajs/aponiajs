import { describe, expect, test } from "bun:test";
import {
  dynamicModuleIssues,
  optionsTokenIssues,
  pluginRegistrationIssues,
  registrationIsolationIssues,
} from "@aponiajs/testing";
import { EVENT_EMITTER_MODULE_OPTIONS, EventEmitter, EventEmitterModule } from "./index.ts";

describe("EventEmitterModule registration contract", () => {
  test("satisfies the shared registration contract", () => {
    const definition = EventEmitterModule.forRoot();

    expect(pluginRegistrationIssues(EventEmitterModule, { asynchronous: false })).toEqual([]);
    expect(dynamicModuleIssues(definition, EventEmitterModule)).toEqual([]);
    expect(optionsTokenIssues(definition, EVENT_EMITTER_MODULE_OPTIONS)).toEqual([]);
    expect(definition.id).toBe("EventEmitterModule");
    expect(definition.exports).toContain(EventEmitter);
  });

  test("is global by default, matching the official package", () => {
    expect(EventEmitterModule.forRoot().global).toBe(true);
  });

  test("keeps two registrations' identities independent", () => {
    expect(
      registrationIsolationIssues(
        EventEmitterModule.forRoot(),
        EventEmitterModule.forRoot(),
        EventEmitterModule,
      ),
    ).toEqual([]);
  });

  test("the register alias delegates to forRoot", () => {
    expect(EventEmitterModule.register().module).toBe(EventEmitterModule);
  });
});
