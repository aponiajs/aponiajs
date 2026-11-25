import {
  AponiaError,
  Module,
  createToken,
  provideFactory,
  type DynamicModule,
  type Provider,
} from "@aponiajs/common";
import { DatabaseService } from "./database.service.ts";
import type { DatabaseClient } from "./interfaces/database.interface.ts";
import type {
  MigrationFile,
  MigrationLock,
  MigrationStore,
} from "./interfaces/migration.interface.ts";
import type { DatabaseModuleOptions } from "./interfaces/database-module.interface.ts";
import {
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  type DatabaseModuleExtras,
  type DatabaseModuleRegistrationAsyncOptions,
  type DatabaseModuleSyncOptions,
} from "./database.module-definition.ts";

const DATABASE_OPTIONS = createToken<DatabaseModuleOptions<object>>("aponia.database.options");

/** Provides the registered Drizzle database, its transaction boundary, and migrations. */
@Module({})
export class DatabaseModule extends ConfigurableModuleClass {
  /**
   * Builds one database registration.
   *
   * The options are validated at registration, so a missing database or a
   * malformed migration list fails before the module is imported.
   *
   * @param options - The Drizzle database and the migrations to apply.
   * @returns A frozen dynamic module an application imports.
   * @throws An `AponiaError` with `INVALID_DATABASE_OPTIONS` when an option is invalid.
   */
  static forRoot<TDatabase extends object>(
    options: DatabaseModuleSyncOptions<TDatabase>,
  ): DynamicModule {
    resolveOptions(options);
    assertExtras(options);
    return registration(super.register(options as DatabaseModuleSyncOptions));
  }

  /**
   * Builds a database registration whose options a factory, a class, or an
   * existing provider resolves.
   *
   * The options are resolved once when the options token first resolves, and
   * validated then, so a refused boot names the same issues `forRoot` reports.
   *
   * @param options - The imports, injected tokens, factory, extras, and extra providers.
   * @returns A frozen dynamic module an application imports.
   */
  static forRootAsync<TDatabase extends object>(
    options: DatabaseModuleRegistrationAsyncOptions<TDatabase>,
  ): DynamicModule {
    assertExtras(options);
    return registration(
      super.registerAsync(options as DatabaseModuleRegistrationAsyncOptions),
      options.extraProviders,
    );
  }

  /**
   * Builds one database registration.
   *
   * @deprecated Use {@link DatabaseModule.forRoot}; retained for the beta line.
   */
  static override register<TDatabase extends object>(
    options: DatabaseModuleSyncOptions<TDatabase>,
  ): DynamicModule {
    return DatabaseModule.forRoot(options);
  }

  /**
   * Builds a database registration whose options a factory resolves.
   *
   * @deprecated Use {@link DatabaseModule.forRootAsync}; retained for the beta line.
   */
  static override registerAsync<TDatabase extends object>(
    options: DatabaseModuleRegistrationAsyncOptions<TDatabase>,
  ): DynamicModule {
    return DatabaseModule.forRootAsync(options);
  }
}

function registration(
  definition: DynamicModule,
  extraProviders: readonly Provider[] = [],
): DynamicModule {
  return Object.freeze({
    ...definition,
    module: DatabaseModule,
    imports: Object.freeze([...(definition.imports ?? [])]),
    controllers: Object.freeze([...(definition.controllers ?? [])]),
    providers: Object.freeze([
      ...(definition.providers ?? []),
      provideFactory(DATABASE_OPTIONS, [MODULE_OPTIONS_TOKEN], (options: DatabaseModuleOptions) =>
        resolveOptions(options),
      ),
      provideFactory(
        DatabaseService,
        [DATABASE_OPTIONS],
        (options: DatabaseModuleOptions) =>
          new DatabaseService({
            database: options.database as DatabaseClient,
            migrations: options.migrations,
          }),
      ),
      ...extraProviders,
    ]),
    exports: Object.freeze([MODULE_OPTIONS_TOKEN, DatabaseService]),
  });
}

function assertExtras(options: Partial<DatabaseModuleExtras>): void {
  if (options.isGlobal !== undefined && typeof options.isGlobal !== "boolean") {
    throw invalid(["isGlobal must be a boolean"]);
  }
}

interface ResolvedDatabaseOptions {
  readonly database: object;
  readonly migrations?:
    | {
        readonly files: readonly MigrationFile[];
        readonly store?: MigrationStore;
        readonly lock?: MigrationLock;
      }
    | undefined;
}

/**
 * Validates one registration's options and copies the collections it owns.
 *
 * The issue list is total: every field that fails is reported, so a refused
 * boot names the whole set rather than the first one found.
 *
 * @param options - The registration options to validate.
 * @returns The frozen options the service reads.
 * @throws An `AponiaError` with `INVALID_DATABASE_OPTIONS`.
 */
export function resolveOptions(options: DatabaseModuleOptions): ResolvedDatabaseOptions {
  const issues: string[] = [];
  if (typeof options !== "object" || options === null) {
    throw invalid(["options must be an object"]);
  }

  const database = options.database;
  if (typeof database !== "object" || database === null) {
    issues.push("database must be a Drizzle database instance");
  }

  const migrations = options.migrations;
  let resolvedMigrations: ResolvedDatabaseOptions["migrations"];
  if (migrations !== undefined) {
    if (typeof migrations !== "object" || migrations === null) {
      issues.push("migrations must be an object when present");
    } else {
      const files = migrations.files;
      if (!Array.isArray(files)) {
        issues.push("migrations.files must be an array");
      } else {
        files.forEach((file, index) => {
          if (typeof file !== "object" || file === null) {
            issues.push(`migrations.files[${index}] must be an object`);
            return;
          }
          if (typeof file.name !== "string" || file.name.trim() === "") {
            issues.push(`migrations.files[${index}].name must be a non-empty string`);
          }
          if (typeof file.sql !== "string") {
            issues.push(`migrations.files[${index}].sql must be a string`);
          }
        });
      }

      const store = migrations.store;
      if (store !== undefined) {
        if (typeof store !== "object" || store === null) {
          issues.push("migrations.store must implement MigrationStore");
        } else {
          for (const method of ["applied", "record"] as const) {
            if (typeof (store as unknown as Record<string, unknown>)[method] !== "function") {
              issues.push(`migrations.store is missing ${method}`);
            }
          }
          if (
            (store as { readonly checksum?: unknown }).checksum !== undefined &&
            typeof (store as { readonly checksum?: unknown }).checksum !== "function"
          ) {
            issues.push("migrations.store.checksum must be a function when present");
          }
        }
      }

      if (migrations.lock !== undefined && typeof migrations.lock !== "function") {
        issues.push("migrations.lock must be a function");
      }

      resolvedMigrations = Object.freeze({
        files: Object.freeze([...(files ?? [])]),
        store,
        lock: migrations.lock,
      });
    }
  }

  if (issues.length > 0) {
    throw invalid(issues);
  }

  return Object.freeze({ database: database as object, migrations: resolvedMigrations });
}

function invalid(issues: readonly string[]): AponiaError {
  return new AponiaError("INVALID_DATABASE_OPTIONS", "The database registration is invalid.", {
    issues: Object.freeze([...issues]),
  });
}
