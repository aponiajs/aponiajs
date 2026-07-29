import { expect, test } from "bun:test";
import { registerInModule } from "../src/generation/module-registration.ts";

const emptyModule = `import { Module } from "@aponiajs/common";

@Module({})
export class AppModule {}
`;

test("adds a missing metadata property and reuses an existing import declaration", () => {
  const source = `import { Module } from "@aponiajs/common";
import { ExistingService } from "./services.ts";

@Module({})
export class AppModule {}
`;

  const updated = registerInModule(source, "providers", "UsersService", "./services.ts");

  expect(updated).toContain('import { ExistingService, UsersService } from "./services.ts";');
  expect(updated).toContain("providers: [UsersService],");
});

test("returns source unchanged when the symbol is already registered", () => {
  const source = `import { Module } from "@aponiajs/common";
import { UsersService } from "./users.service.ts";

@Module({
  providers: [UsersService],
})
export class AppModule {}
`;

  expect(registerInModule(source, "providers", "UsersService", "./users.service.ts")).toBe(source);
});

test("registers a symbol when its import exists but metadata does not contain it", () => {
  const source = `import { Module } from "@aponiajs/common";
import { UsersService } from "./users.service.ts";

@Module({
  providers: [],
})
export class AppModule {}
`;

  const updated = registerInModule(source, "providers", "UsersService", "./users.service.ts");

  expect(updated.match(/import \{ UsersService \}/g)).toHaveLength(1);
  expect(updated).toContain("providers: [UsersService],");
});

test("rejects sources without an object-valued Module decorator", () => {
  expect(() =>
    registerInModule(
      "export class AppModule {}",
      "providers",
      "UsersService",
      "./users.service.ts",
    ),
  ).toThrow("The declaring module does not contain a @Module() metadata object.");
  expect(() =>
    registerInModule(
      'import { Module } from "@aponiajs/common";\n@Module()\nexport class AppModule {}\n',
      "providers",
      "UsersService",
      "./users.service.ts",
    ),
  ).toThrow("The declaring module does not contain a @Module() metadata object.");
});

test("rejects non-property and non-array registration metadata", () => {
  const methodMetadata = `import { Module } from "@aponiajs/common";

@Module({
  providers() {},
})
export class AppModule {}
`;
  const nonArrayMetadata = `import { Module } from "@aponiajs/common";

@Module({
  providers: ExistingService,
})
export class AppModule {}
`;

  expect(() =>
    registerInModule(methodMetadata, "providers", "UsersService", "./users.service.ts"),
  ).toThrow('Module metadata "providers" must be a property assignment.');
  expect(() =>
    registerInModule(nonArrayMetadata, "providers", "UsersService", "./users.service.ts"),
  ).toThrow('Module metadata "providers" must be an array.');
});

test("supports every module registration collection", () => {
  expect(registerInModule(emptyModule, "imports", "UsersModule", "./users.module.ts")).toContain(
    "imports: [UsersModule],",
  );
  expect(
    registerInModule(emptyModule, "controllers", "UsersController", "./users.controller.ts"),
  ).toContain("controllers: [UsersController],");
  expect(
    registerInModule(emptyModule, "providers", "UsersService", "./users.service.ts"),
  ).toContain("providers: [UsersService],");
});
