import { describe, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import {
  asyncRegistrationShapeIssues,
  dynamicModuleIssues,
  optionsTokenIssues,
  pluginRegistrationIssues,
  registrationIsolationIssues,
} from "@aponiajs/testing";
import { DatabaseModule, DatabaseService, MODULE_OPTIONS_TOKEN } from "./index.ts";

describe("DatabaseModule registration contract", () => {
  test("satisfies the shared registration contract", () => {
    const definition = DatabaseModule.forRoot({ database: {} });

    expect(pluginRegistrationIssues(DatabaseModule)).toEqual([]);
    expect(dynamicModuleIssues(definition, DatabaseModule)).toEqual([]);
    expect(optionsTokenIssues(definition, MODULE_OPTIONS_TOKEN)).toEqual([]);
    expect(definition.id).toBe("DatabaseModule");
    expect(definition.exports).toContain(DatabaseService);
  });

  test("keeps two registrations' identities independent", () => {
    expect(
      registrationIsolationIssues(
        DatabaseModule.forRoot({ database: {} }),
        DatabaseModule.forRoot({ database: {} }),
        DatabaseModule,
      ),
    ).toEqual([]);
  });

  test("isGlobal reaches the definition when stated", () => {
    expect(DatabaseModule.forRoot({ database: {} }).global).toBe(false);
    expect(DatabaseModule.forRoot({ database: {}, isGlobal: true }).global).toBe(true);
    expect(() => DatabaseModule.forRoot({ database: {}, isGlobal: 1 as never })).toThrow(
      AponiaError,
    );
  });

  test("the register alias delegates to forRoot", () => {
    expect(DatabaseModule.register({ database: {} }).module).toBe(DatabaseModule);
  });

  test("accepts the three asynchronous shapes", () => {
    expect(
      asyncRegistrationShapeIssues(
        DatabaseModule.forRootAsync.bind(DatabaseModule),
        DatabaseModule,
        MODULE_OPTIONS_TOKEN,
      ),
    ).toEqual([]);
  });

  test("fails fast on a missing database and reports every issue", () => {
    const error = capture(() => DatabaseModule.forRoot({} as never));

    expect(error.code).toBe("INVALID_DATABASE_OPTIONS");
    expect(error.details.issues).toEqual(["database must be a Drizzle database instance"]);
  });

  test("fails fast on a malformed migration list and store", () => {
    const error = capture(() =>
      DatabaseModule.forRoot({
        database: {},
        migrations: {
          files: [{ name: "", sql: 1 as never }],
          store: {} as never,
        },
      }),
    );

    expect(error.code).toBe("INVALID_DATABASE_OPTIONS");
    expect(error.details.issues).toEqual([
      "migrations.files[0].name must be a non-empty string",
      "migrations.files[0].sql must be a string",
      "migrations.store is missing applied",
      "migrations.store is missing record",
    ]);
  });

  test("the registerAsync alias delegates to forRootAsync", () => {
    const definition = DatabaseModule.registerAsync({
      useFactory: () => ({ database: {} }),
    });

    expect(definition.module).toBe(DatabaseModule);
  });

  test("reports every malformed value and migration shape it refuses", () => {
    const cases: readonly [string, () => unknown][] = [
      ["options must be an object", () => DatabaseModule.forRoot(null as never)],
      [
        "migrations must be an object when present",
        () => DatabaseModule.forRoot({ database: {}, migrations: "x" as never }),
      ],
      [
        "migrations.files must be an array",
        () => DatabaseModule.forRoot({ database: {}, migrations: { files: "x" as never } }),
      ],
      [
        "migrations.files[0] must be an object",
        () =>
          DatabaseModule.forRoot({
            database: {},
            migrations: { files: [null as never] },
          }),
      ],
      [
        "migrations.store must implement MigrationStore",
        () =>
          DatabaseModule.forRoot({
            database: {},
            migrations: { files: [], store: "x" as never },
          }),
      ],
      [
        "migrations.store.checksum must be a function when present",
        () =>
          DatabaseModule.forRoot({
            database: {},
            migrations: {
              files: [],
              store: {
                applied: () => [],
                record: () => {},
                checksum: 1 as never,
              },
            },
          }),
      ],
      [
        "migrations.lock must be a function",
        () =>
          DatabaseModule.forRoot({
            database: {},
            migrations: { files: [], lock: "x" as never },
          }),
      ],
    ];

    for (const [issue, run] of cases) {
      const error = capture(run);
      expect(error.code).toBe("INVALID_DATABASE_OPTIONS");
      expect(error.details.issues).toContain(issue);
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
