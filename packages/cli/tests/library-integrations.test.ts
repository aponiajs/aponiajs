import { expect, test } from "bun:test";
import { parseArguments } from "../src/commands/arguments.ts";
import { createComponentNames } from "../src/generation/component-names.ts";
import { registerInModule } from "../src/generation/module-registration.ts";

test("yargs-parser handles aliases, inline values, and boolean negation", () => {
  expect(
    parseArguments(["g", "resource", "users", "--type=graphql-code-first", "--no-crud", "-d"]),
  ).toMatchObject({
    command: "generate",
    schematic: "resource",
    name: "users",
    type: "graphql-code-first",
    crud: false,
    dryRun: true,
  });
  expect(() => parseArguments(["g", "service", "users", "--unknown"])).toThrow(
    'Unknown option "--unknown".',
  );
});

test("change-case and inflection normalize compound and irregular names", () => {
  expect(createComponentNames("Admin/HTTPPeople")).toEqual({
    fileName: "http-people",
    className: "HttpPeople",
    propertyName: "httpPeople",
    singularFileName: "http-person",
    singularClassName: "HttpPerson",
    routePath: "http-people",
  });
});

test("ts-morph safely registers symbols in structured module metadata", () => {
  const source = `import { Module } from "@aponiajs/common";
import { ExistingService } from "./existing.service.ts";

const settings = { text: "a } bracket in a string" };

@Module({
  providers: [
    ExistingService,
  ],
})
export class AppModule {
  readonly settings = settings;
}
`;

  const updated = registerInModule(source, "providers", "UsersService", "./users/users.service.ts");
  expect(updated).toContain('import { UsersService } from "./users/users.service.ts";');
  expect(updated).toContain("ExistingService");
  expect(updated).toContain("UsersService");
  expect(updated).toContain('text: "a } bracket in a string"');
});
