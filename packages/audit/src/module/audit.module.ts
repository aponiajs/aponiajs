import {
  AponiaError,
  Module,
  createToken,
  provideFactory,
  type DynamicModule,
  type Provider,
} from "@aponiajs/common";
import { AuditService } from "../service/audit.service.ts";
import { MemoryAuditStore } from "../store/memory-audit.store.ts";
import type {
  AuditModuleOptions,
  RegistrationAuditOptions,
} from "../interfaces/audit.interface.ts";
import {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  type AuditModuleExtras,
  type AuditModuleRegistrationAsyncOptions,
  type AuditModuleSyncOptions,
} from "./audit.module-definition.ts";

const defaultMaxEntries = 1_000;

const AUDIT_OPTIONS = createToken<RegistrationAuditOptions>("aponia.audit.options");

/** Provides a bounded audit service and its store. */
@Module({})
export class AuditModule extends ConfigurableModuleClass {
  /**
   * Builds one audit registration.
   *
   * @param options - The store, entry cap, and extra redacted keys.
   * @returns A frozen dynamic module an application imports.
   * @throws An `AponiaError` with `INVALID_AUDIT_OPTIONS` when an option is invalid.
   */
  static forRoot(options: AuditModuleSyncOptions = {}): DynamicModule {
    resolveOptions(options);
    assertExtras(options);
    return registration(super.register(options));
  }

  /**
   * Builds an audit registration whose options a factory, a class, or an
   * existing provider resolves.
   *
   * The options are resolved once when the options token first resolves, and
   * validated then, so a refused boot names the same issues `forRoot` reports.
   *
   * @param options - The imports, injected tokens, factory, extras, and extra providers.
   * @returns A frozen dynamic module an application imports.
   */
  static forRootAsync(options: AuditModuleRegistrationAsyncOptions): DynamicModule {
    assertExtras(options);
    return registration(super.registerAsync(options), options.extraProviders);
  }

  /**
   * Builds one audit registration.
   *
   * @deprecated Use {@link AuditModule.forRoot}; retained for the beta line.
   */
  static override register(options: AuditModuleSyncOptions = {}): DynamicModule {
    return AuditModule.forRoot(options);
  }

  /**
   * Builds an audit registration whose options a factory resolves.
   *
   * @deprecated Use {@link AuditModule.forRootAsync}; retained for the beta line.
   */
  static override registerAsync(options: AuditModuleRegistrationAsyncOptions): DynamicModule {
    return AuditModule.forRootAsync(options);
  }
}

function registration(
  definition: DynamicModule,
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  return Object.freeze({
    ...definition,
    module: AuditModule,
    imports: Object.freeze([...(definition.imports ?? [])]),
    controllers: Object.freeze([...(definition.controllers ?? [])]),
    providers: Object.freeze([
      ...(definition.providers ?? []),
      provideFactory(AUDIT_OPTIONS, [MODULE_OPTIONS_TOKEN], (options: AuditModuleOptions) =>
        resolveOptions(options),
      ),
      provideFactory(
        AuditService,
        [AUDIT_OPTIONS],
        (options: RegistrationAuditOptions) =>
          new AuditService(
            options.store ?? new MemoryAuditStore({ maxEntries: options.maxEntries }),
            options.redact,
          ),
      ),
      ...extraProviders,
    ]),
    exports: Object.freeze([MODULE_OPTIONS_TOKEN, AuditService]),
  });
}

function assertExtras(options: Partial<AuditModuleExtras>): void {
  if (options.isGlobal !== undefined && typeof options.isGlobal !== "boolean") {
    throw new AponiaError(
      "INVALID_AUDIT_OPTIONS",
      "The audit registration is invalid: isGlobal must be a boolean.",
      { issues: Object.freeze(["isGlobal must be a boolean"]) },
    );
  }
}

function resolveOptions(options: AuditModuleOptions): RegistrationAuditOptions {
  const maxEntries = options.maxEntries ?? defaultMaxEntries;
  const issues: string[] = [];

  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    issues.push("maxEntries must be a positive integer");
  }
  if (options.redact !== undefined && !Array.isArray(options.redact)) {
    issues.push("redact must be an array of keys");
  }
  if (issues.length > 0) {
    throw new AponiaError("INVALID_AUDIT_OPTIONS", "The audit registration is invalid.", {
      issues: Object.freeze(issues),
    });
  }
  return Object.freeze({ maxEntries, store: options.store, redact: options.redact });
}
