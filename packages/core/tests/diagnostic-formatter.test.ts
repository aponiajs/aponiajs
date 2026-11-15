import { describe, expect, it } from "bun:test";
import {
  AponiaError,
  createToken,
  defineModule,
  provideClass,
  provideFactory,
} from "@aponiajs/common";
import { compileModuleGraph } from "../src/index.ts";
import { formatMissingProviderDiagnostic } from "../src/graph/diagnostic-formatter.ts";

describe("DI Diagnostic Formatter", () => {
  it("renders codeframe, diagnosis, and copy-paste quick fix when provider is declared but not exported", () => {
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

  it("renders codeframe, diagnosis, and copy-paste quick fix when declaring module is not imported", () => {
    const formatted = formatMissingProviderDiagnostic({
      token: "AuthService",
      requestingModule: "BillingModule",
      declaringModule: "AuthModule",
      isImported: false,
    });

    expect(formatted).toContain("MISSING_PROVIDER");
    expect(formatted).toContain("Diagnosis:");
    expect(formatted).toContain(
      '"AuthService" is declared in "AuthModule", but "BillingModule" does not import "AuthModule"',
    );
    expect(formatted).toContain("Quick Fix:");
    expect(formatted).toContain("+    imports: [AuthModule]");
  });

  it("renders codeframe, diagnosis, and copy-paste quick fix when token is not declared anywhere", () => {
    const formatted = formatMissingProviderDiagnostic({
      token: "ConfigService",
      requestingModule: "AppModule",
    });

    expect(formatted).toContain("MISSING_PROVIDER");
    expect(formatted).toContain("Diagnosis:");
    expect(formatted).toContain(
      'Token "ConfigService" is not declared in any module in the dependency graph',
    );
    expect(formatted).toContain("Quick Fix:");
    expect(formatted).toContain("+    providers: [ConfigService]");
  });

  it("attaches formatted diagnostic and quick fix to MISSING_PROVIDER error during graph compilation", () => {
    class UsersService {}
    class OrdersService {
      constructor(readonly users: UsersService) {}
    }

    const usersModule = defineModule({
      id: "UsersModule",
      providers: [provideClass(UsersService, [])],
      exports: [], // forgotten export
    });

    const ordersModule = defineModule({
      id: "OrdersModule",
      imports: [usersModule],
      providers: [provideClass(OrdersService, [UsersService] as const)],
    });

    const rootModule = defineModule({
      id: "RootModule",
      imports: [ordersModule],
    });

    try {
      compileModuleGraph(rootModule);
      expect().fail("Should have thrown MISSING_PROVIDER");
    } catch (error) {
      expect(error).toBeInstanceOf(AponiaError);
      const aponiaError = error as AponiaError;
      expect(aponiaError.code).toBe("MISSING_PROVIDER");
      expect(aponiaError.message).toContain("[Aponia DI Error] MISSING_PROVIDER");
      expect(aponiaError.message).toContain("Quick Fix:");
      expect(aponiaError.message).toContain("+    exports: [UsersService]");
      expect(typeof aponiaError.details.diagnostic).toBe("string");
      expect(aponiaError.details.diagnostic).toContain("UsersModule");
    }
  });

  it("attaches import quick fix when dependency is in unimported module", () => {
    class ProviderService {}
    class Consumer {
      constructor(readonly dep: ProviderService) {}
    }

    const providerModule = defineModule({
      id: "ProviderModule",
      providers: [provideClass(ProviderService, [])],
      exports: [ProviderService],
    });

    const consumerModule = defineModule({
      id: "ConsumerModule",
      imports: [], // missing import
      providers: [provideClass(Consumer, [ProviderService] as const)],
    });

    const root = defineModule({
      id: "Root",
      imports: [consumerModule, providerModule],
    });

    try {
      compileModuleGraph(root);
      expect().fail("Should have thrown MISSING_PROVIDER");
    } catch (error) {
      expect(error).toBeInstanceOf(AponiaError);
      const aponiaError = error as AponiaError;
      expect(aponiaError.code).toBe("MISSING_PROVIDER");
      expect(aponiaError.message).toContain("+    imports: [ProviderModule]");
    }
  });

  it("attaches provide quick fix when dependency is not declared anywhere", () => {
    const orphanToken = createToken<string>("OrphanToken");
    const consumerToken = createToken<string>("Consumer");

    const consumerModule = defineModule({
      id: "OrphanConsumerModule",
      providers: [provideFactory(consumerToken, [orphanToken] as const, (dep) => dep)],
    });

    try {
      compileModuleGraph(consumerModule);
      expect().fail("Should have thrown MISSING_PROVIDER");
    } catch (error) {
      expect(error).toBeInstanceOf(AponiaError);
      const aponiaError = error as AponiaError;
      expect(aponiaError.code).toBe("MISSING_PROVIDER");
      expect(aponiaError.message).toContain("+    providers: [OrphanToken]");
    }
  });
});
