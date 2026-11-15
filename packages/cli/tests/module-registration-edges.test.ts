import { expect, test } from "bun:test";
import { registerInModule } from "../src/generation/module-registration.ts";

test("rejects a @Module decorator whose argument is not an object literal", () => {
  const source = `import { Module } from "@aponiajs/common";

const metadata = { providers: [] };

@Module(metadata)
export class AppModule {}
`;

  expect(() => registerInModule(source, "providers", "UsersService", "./users.service.ts")).toThrow(
    "The declaring module does not contain a @Module() metadata object.",
  );
});

test("adds a missing collection while reusing the symbol's existing import", () => {
  const source = `import { Module } from "@aponiajs/common";
import { UsersService } from "./users.service.ts";

@Module({})
export class AppModule {}
`;

  const updated = registerInModule(source, "providers", "UsersService", "./users.service.ts");

  expect(updated.match(/import \{ UsersService \}/g)).toHaveLength(1);
  expect(updated).toContain("providers: [UsersService],");
});

test("registers into the first decorated class when one file declares two modules", () => {
  const source = `import { Module } from "@aponiajs/common";

@Module({ providers: [] })
export class FirstModule {}

@Module({ providers: [] })
export class SecondModule {}
`;

  const updated = registerInModule(source, "providers", "UsersService", "./users.service.ts");

  expect(updated).toContain("providers: [UsersService] })\nexport class FirstModule {}");
  expect(updated).toContain("providers: [] })\nexport class SecondModule {}");
});
