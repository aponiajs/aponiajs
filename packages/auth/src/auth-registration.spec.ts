import { describe, expect, test } from "bun:test";
import { AponiaError, APP_GUARD } from "@aponiajs/common";
import type { DynamicModule } from "@aponiajs/common";
import {
  dynamicModuleIssues,
  optionsTokenIssues,
  pluginRegistrationIssues,
  registrationIsolationIssues,
} from "@aponiajs/testing";
import {
  AUTH_VERIFIER,
  AuthGuard,
  AuthModule,
  AuthService,
  JwtService,
  MODULE_OPTIONS_TOKEN,
} from "./index.ts";

const secret = "a".repeat(32);

function globalGuards(definition: DynamicModule): readonly unknown[] {
  return (definition.providers ?? []).filter(
    (provider) => (provider as { readonly provide?: unknown }).provide === APP_GUARD,
  );
}

describe("AuthModule registration contract", () => {
  test("satisfies the shared registration contract", () => {
    const definition = AuthModule.forRoot({ jwt: { secret } });

    expect(pluginRegistrationIssues(AuthModule, { asynchronous: false })).toEqual([]);
    expect(dynamicModuleIssues(definition, AuthModule)).toEqual([]);
    expect(optionsTokenIssues(definition, MODULE_OPTIONS_TOKEN)).toEqual([]);
    expect(definition.id).toBe("AuthModule");
    expect(definition.exports).toContain(AUTH_VERIFIER);
    expect(definition.exports).toContain(JwtService);
    expect(definition.exports).toContain(AuthService);
    expect(definition.exports).toContain(AuthGuard);
  });

  test("keeps two registrations' identities independent", () => {
    expect(
      registrationIsolationIssues(
        AuthModule.forRoot({ jwt: { secret } }),
        AuthModule.forRoot({ jwt: { secret } }),
        AuthModule,
      ),
    ).toEqual([]);
  });

  test("is global and guarded by default, and can opt out of each", () => {
    expect(AuthModule.forRoot({ jwt: { secret } }).global).toBe(true);
    expect(globalGuards(AuthModule.forRoot({ jwt: { secret } }))).toHaveLength(1);
    expect(AuthModule.forRoot({ jwt: { secret }, isGlobal: false }).global).toBe(false);
    expect(globalGuards(AuthModule.forRoot({ jwt: { secret }, globalGuard: false }))).toHaveLength(
      0,
    );
    expect(() => AuthModule.forRoot({ jwt: { secret }, isGlobal: 1 as never })).toThrow(
      AponiaError,
    );
    expect(() => AuthModule.forRoot({ jwt: { secret }, globalGuard: 1 as never })).toThrow(
      AponiaError,
    );
  });

  test("the register alias delegates to forRoot", () => {
    expect(AuthModule.register({ jwt: { secret } }).module).toBe(AuthModule);
  });

  test("refuses the asynchronous form, naming why", () => {
    const error = capture(() => AuthModule.registerAsync({} as never));

    expect(error.code).toBe("INVALID_AUTH_OPTIONS");
    expect(error.details.issues).toEqual(["registerAsync is not supported"]);
  });

  test("refuses a registration that states both or neither verifier arm", () => {
    expect(capture(() => AuthModule.forRoot({} as never)).details.issues).toEqual([
      "exactly one of jwt or oidc must be present",
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
