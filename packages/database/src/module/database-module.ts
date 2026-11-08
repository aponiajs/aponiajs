import { Module, provideValue, type DynamicModule } from "@aponiajs/common";
import { DatabaseService } from "../database/database.service.ts";
import type { DatabaseModuleOptions } from "./database-module.types.ts";

/** Provides the registered Drizzle database, its transaction boundary, and migrations. */
@Module({})
export class DatabaseModule {
  /** Builds one database registration. */
  static register<TDatabase extends object>(
    options: DatabaseModuleOptions<TDatabase>,
  ): DynamicModule {
    const service = new DatabaseService({
      database: options.database,
      migrations: options.migrations,
    });

    return Object.freeze({
      module: DatabaseModule,
      id: "DatabaseModule",
      instanceId: Symbol("DatabaseModule"),
      imports: Object.freeze([]),
      controllers: Object.freeze([]),
      providers: Object.freeze([provideValue(DatabaseService, service)]),
      exports: Object.freeze([DatabaseService]),
    });
  }
}
