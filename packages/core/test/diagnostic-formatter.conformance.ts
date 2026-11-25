import { AponiaError, defineModule, provideClass } from "@aponiajs/common";
import { compileModuleGraph, formatMissingProviderDiagnostic } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

test("the Vite+ lane formats actionable missing provider diagnostics", () => {
  const formatted = formatMissingProviderDiagnostic({
    token: "UsersService",
    requestingModule: "OrdersModule",
    declaringModule: "UsersModule",
    isImported: true,
    isExported: false,
  });

  expect(formatted).toContain("MISSING_PROVIDER");
  expect(formatted).toContain("Diagnosis:");
  expect(formatted).toContain(
    '"UsersService" is declared in "UsersModule", and "OrdersModule" imports "UsersModule"',
  );
  expect(formatted).toContain("Quick Fix:");
  expect(formatted).toContain("+    exports: [UsersService]");
});

test("the Vite+ lane attaches quick fix diagnostic to MISSING_PROVIDER error in graph compilation", () => {
  class VpService {}
  class VpConsumer {
    constructor(readonly service: VpService) {}
  }

  const serviceModule = defineModule({
    id: "VpServiceModule",
    providers: [provideClass(VpService, [])],
    exports: [],
  });

  const consumerModule = defineModule({
    id: "VpConsumerModule",
    imports: [serviceModule],
    providers: [provideClass(VpConsumer, [VpService] as const)],
  });

  expect(() => compileModuleGraph(consumerModule)).toThrow(
    expect.objectContaining({
      code: "MISSING_PROVIDER",
    }),
  );

  try {
    compileModuleGraph(consumerModule);
  } catch (error) {
    expect(error).toBeInstanceOf(AponiaError);
    const aponiaError = error as AponiaError;
    expect(aponiaError.code).toBe("MISSING_PROVIDER");
    expect(aponiaError.message).toContain("+    exports: [VpService]");
  }
});
