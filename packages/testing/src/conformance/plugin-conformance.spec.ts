import { expect, test } from "bun:test";
import { Module, createToken, dynamicModule, provideValue } from "@aponiajs/common";
import type { DynamicModule } from "@aponiajs/common";
import {
  asyncRegistrationShapeIssues,
  dynamicModuleIssues,
  optionsTokenIssues,
  pluginRegistrationIssues,
  registrationIsolationIssues,
  teardownIssues,
} from "../index.ts";

const compliant = { forRoot: () => undefined, forRootAsync: () => undefined };

test("accepts a module that exposes both registrations", () => {
  expect(pluginRegistrationIssues(compliant)).toEqual([]);
});

test("names a missing registration in contract order", () => {
  expect(pluginRegistrationIssues({})).toEqual(["forRoot", "forRootAsync"]);
  expect(pluginRegistrationIssues({ forRoot: () => undefined })).toEqual(["forRootAsync"]);
});

test("does not require an asynchronous registration when the package states why", () => {
  expect(pluginRegistrationIssues({ forRoot: () => undefined }, { asynchronous: false })).toEqual(
    [],
  );
});

@Module({})
class CompliantModule {}

function registration(options: {
  readonly value: string;
  readonly global?: boolean;
}): DynamicModule {
  return dynamicModule({
    module: CompliantModule,
    ...(options.global === undefined ? {} : { global: options.global }),
    providers: Object.freeze([provideValue("value", options.value)]),
  });
}

test("accepts a frozen registration whose module is the class itself", () => {
  expect(dynamicModuleIssues(registration({ value: "one" }), CompliantModule)).toEqual([]);
});

test("names an identity, freeze, or id defect in contract order", () => {
  const unfrozen = {
    module: CompliantModule,
    id: "",
    instanceId: Symbol("x"),
    providers: [] as readonly unknown[],
  } as never;

  expect(dynamicModuleIssues(unfrozen, CompliantModule)).toEqual(["definition", "id", "providers"]);
  expect(dynamicModuleIssues(registration({ value: "one" }), class Other {})).toEqual(["module"]);
});

test("two registrations of one module stay independent", () => {
  const first = registration({ value: "one" });
  const second = registration({ value: "two" });

  expect(registrationIsolationIssues(first, second, CompliantModule)).toEqual([]);
  expect(registrationIsolationIssues(first, first, CompliantModule)).toEqual([
    "shared definition",
    "shared instanceId",
  ]);
});

test("optionsTokenIssues reports a missing provider and export", () => {
  const token = createToken<object>("OPTIONS");
  const provided = dynamicModule({
    module: CompliantModule,
    providers: Object.freeze([provideValue(token, {})]),
    exports: Object.freeze([token]),
  });

  expect(optionsTokenIssues(provided, token)).toEqual([]);
  expect(optionsTokenIssues(registration({ value: "one" }), token)).toEqual(["provider", "export"]);
  expect(
    optionsTokenIssues(
      dynamicModule({
        module: CompliantModule,
        providers: Object.freeze([provideValue(token, {})]),
      }),
      token,
    ),
  ).toEqual(["export"]);
});

test("asyncRegistrationShapeIssues accepts the three Nest shapes", () => {
  const token = createToken<object>("OPTIONS");
  const registerAsync = (options: { useFactory?: () => object }): DynamicModule =>
    dynamicModule({
      module: CompliantModule,
      providers: Object.freeze([provideValue(token, options.useFactory ?? {})]),
      exports: Object.freeze([token]),
    });

  expect(asyncRegistrationShapeIssues(registerAsync as never, CompliantModule, token)).toEqual([]);
});

test("asyncRegistrationShapeIssues calls a static registration on its module class", () => {
  const token = createToken<object>("OPTIONS");
  class StaticModule {
    static forRootAsync(
      this: typeof StaticModule,
      options: { useFactory?: () => object },
    ): DynamicModule {
      return dynamicModule({
        module: this,
        providers: Object.freeze([provideValue(token, options.useFactory?.() ?? {})]),
        exports: Object.freeze([token]),
      });
    }
  }

  // The helper calls the registration with the module class as its receiver.
  // oxlint-disable-next-line typescript/unbound-method
  expect(asyncRegistrationShapeIssues(StaticModule.forRootAsync, StaticModule, token)).toEqual([]);
});

test("asyncRegistrationShapeIssues names a shape that threw", () => {
  const token = createToken<object>("OPTIONS");
  const registerAsync = () => {
    throw new Error("unsupported");
  };

  const issues = asyncRegistrationShapeIssues(registerAsync as never, CompliantModule, token);
  expect(issues).toHaveLength(3);
  expect(issues[0]).toContain("useFactory");
});

test("dynamicModuleIssues names a registration that states no instance identity", () => {
  const definition = Object.freeze({
    module: CompliantModule,
    id: "compliant",
    providers: Object.freeze([]),
  });

  expect(dynamicModuleIssues(definition as never, CompliantModule)).toEqual(["instanceId"]);
});

test("asyncRegistrationShapeIssues prefixes each broken shape rule", () => {
  const token = createToken<object>("OPTIONS");
  const unfrozen = {
    module: CompliantModule,
    id: "",
    instanceId: Symbol("x"),
    providers: [],
  };
  const registerAsync = (): DynamicModule => unfrozen as never;

  expect(asyncRegistrationShapeIssues(registerAsync as never, CompliantModule, token)).toEqual([
    "useFactory:definition",
    "useFactory:id",
    "useFactory:providers",
    "useFactory:options token",
    "useClass:definition",
    "useClass:id",
    "useClass:providers",
    "useClass:options token",
    "useExisting:definition",
    "useExisting:id",
    "useExisting:providers",
    "useExisting:options token",
  ]);
});

test("asyncRegistrationShapeIssues reports a frozen registration that misses the options token", () => {
  const token = createToken<object>("OPTIONS");
  const registerAsync = (): DynamicModule =>
    dynamicModule({
      module: CompliantModule,
      providers: Object.freeze([provideValue("value", 1)]),
    });

  expect(asyncRegistrationShapeIssues(registerAsync as never, CompliantModule, token)).toEqual([
    "useFactory:options token",
    "useClass:options token",
    "useExisting:options token",
  ]);
});

test("optionsTokenIssues accepts a providers list that names the token directly", () => {
  const token = createToken<object>("OPTIONS");
  const definition = dynamicModule({
    module: CompliantModule,
    providers: Object.freeze([token as never]),
    exports: Object.freeze([token]),
  });

  expect(optionsTokenIssues(definition, token)).toEqual([]);
});

test("teardownIssues accepts an idempotent close and reports a throw", async () => {
  let closes = 0;
  const idempotent = await teardownIssues(async () => void closes++);
  expect(idempotent).toEqual([]);
  expect(closes).toBe(2);

  const failing = await teardownIssues(async () => {
    throw new Error("cannot close");
  });
  expect(failing).toEqual(["threw cannot close"]);
});
