import { expect, spyOn, test } from "bun:test";
import { parseArguments, runCli } from "../src/index.ts";

const attachedValueCases = [
  ["--dry-run", ["new", "app", "--dry-run=abc"]],
  ["--skip-install", ["new", "app", "--skip-install=abc"]],
  ["--dry-run", ["generate", "controller", "user", "--dry-run=abc"]],
  ["--crud", ["generate", "controller", "user", "--crud=abc"]],
  ["--flat", ["generate", "controller", "user", "--flat=abc"]],
  ["--spec", ["generate", "controller", "user", "--spec=abc"]],
  ["--skip-import", ["generate", "controller", "user", "--skip-import=abc"]],
  ["--dry-run", ["build", "--dry-run=abc"]],
] as const;

test.each(attachedValueCases)(
  "rejects a value attached to %s and names the flag",
  (option, arguments_) => {
    expect(() => parseArguments([...arguments_])).toThrow(
      `Option "${option}" does not accept a value.`,
    );
  },
);

test.each([
  ["--dry-run", ["new", "app", "--dry-run=true"]],
  ["--crud", ["generate", "resource", "users", "--crud=false"]],
  ["--flat", ["generate", "controller", "user", "--flat=true"]],
  ["--spec", ["generate", "controller", "user", "--spec=false"]],
  ["--dry-run", ["new", "app", "--dry-run="]],
  ["--skip-import", ["generate", "controller", "user", "--skip-import="]],
] as const)(
  "rejects the %s spelling that used to be coerced into a boolean",
  (option, arguments_) => {
    expect(() => parseArguments([...arguments_])).toThrow(
      `Option "${option}" does not accept a value.`,
    );
  },
);

test.each([
  ["--dry-run", ["new", "app", "-d=abc"]],
  ["--skip-install", ["new", "app", "-s=abc"]],
  ["--dry-run", ["generate", "controller", "user", "-d=abc"]],
] as const)("rejects a value attached to the short alias of %s", (option, arguments_) => {
  expect(() => parseArguments([...arguments_])).toThrow(
    `Option "${option}" does not accept a value.`,
  );
});

test("parses the same flags bare, negated, and through their short aliases", () => {
  expect(parseArguments(["new", "app", "--dry-run", "--skip-install"])).toEqual({
    command: "new",
    name: "app",
    dryRun: true,
    skipInstall: true,
  });
  expect(parseArguments(["new", "app", "-d", "-s"])).toEqual({
    command: "new",
    name: "app",
    dryRun: true,
    skipInstall: true,
  });
  expect(parseArguments(["new", "app", "--no-dry-run", "--no-skip-install"])).toEqual({
    command: "new",
    name: "app",
    dryRun: false,
    skipInstall: false,
  });
  expect(
    parseArguments([
      "generate",
      "controller",
      "user",
      "--crud",
      "--flat",
      "--spec",
      "--skip-import",
    ]),
  ).toMatchObject({
    command: "generate",
    schematic: "controller",
    name: "user",
    dryRun: false,
    crud: true,
    flat: true,
    spec: true,
    skipImport: true,
    type: "rest",
  });
  expect(parseArguments(["generate", "controller", "user", "-d"])).toMatchObject({ dryRun: true });
  expect(
    parseArguments(["generate", "controller", "user", "--no-crud", "--no-flat", "--no-spec"]),
  ).toMatchObject({ crud: false, flat: false, spec: false });
  expect(parseArguments(["generate", "service", "users", "--no-skip-import"])).toMatchObject({
    skipImport: false,
  });
  expect(parseArguments(["build", "--dry-run"])).toEqual({
    command: "build",
    dryRun: true,
  });
  expect(parseArguments(["build", "--no-dry-run"])).toEqual({
    command: "build",
    dryRun: false,
  });
});

test("never consumes the token after a flag, wherever the flag stands", () => {
  // The flags stay declared as booleans, so a flag leaves the next token alone
  // and may stand before, between, or after the positionals. This is the
  // behaviour the pre-scan exists to protect: dropping the declaration rejects
  // `--dry-run=abc` but also makes `aponia new --dry-run app` read `app` as a
  // value.
  expect(parseArguments(["new", "--dry-run", "app"])).toEqual({
    command: "new",
    name: "app",
    dryRun: true,
    skipInstall: false,
  });
  expect(parseArguments(["new", "-d", "app"])).toEqual({
    command: "new",
    name: "app",
    dryRun: true,
    skipInstall: false,
  });
  expect(parseArguments(["new", "--skip-install", "app"])).toEqual({
    command: "new",
    name: "app",
    dryRun: false,
    skipInstall: true,
  });
  expect(parseArguments(["new", "--no-dry-run", "app"])).toEqual({
    command: "new",
    name: "app",
    dryRun: false,
    skipInstall: false,
  });
  expect(parseArguments(["generate", "--flat", "controller", "user"])).toMatchObject({
    schematic: "controller",
    name: "user",
    flat: true,
  });
  expect(parseArguments(["generate", "controller", "--flat", "user"])).toMatchObject({
    schematic: "controller",
    name: "user",
    flat: true,
  });
  expect(parseArguments(["generate", "controller", "--dry-run", "user"])).toMatchObject({
    name: "user",
    dryRun: true,
  });
  expect(parseArguments(["generate", "controller", "--spec", "user", "--flat"])).toMatchObject({
    name: "user",
    spec: true,
    flat: true,
  });
});

test("leaves an unspecified flag undefined so configuration defaults still apply", () => {
  // `flat` and `spec` must stay unspecified rather than become `false`: the
  // generator falls back to the project and global defaults only when they are.
  expect(parseArguments(["generate", "service", "users"])).toEqual({
    command: "generate",
    schematic: "service",
    name: "users",
    dryRun: false,
    flat: undefined,
    spec: undefined,
    skipImport: false,
    crud: true,
    type: "rest",
  });
});

test("still accepts a value on the options that declare one", () => {
  expect(
    parseArguments([
      "generate",
      "controller",
      "user",
      "--type",
      "ws",
      "--module",
      "admin/x",
      "--path",
      "src/users",
      "--project",
      "api",
    ]),
  ).toMatchObject({ type: "ws", module: "admin/x", path: "src/users", project: "api" });
  expect(
    parseArguments(["generate", "controller", "user", "--type=ws", "-p", "api"]),
  ).toMatchObject({ type: "ws", project: "api" });
  expect(
    parseArguments(["generate", "controller", "user", "--module", "admin", "--module", "public"]),
  ).toMatchObject({ module: "public" });
});

test.serial("exits with 1 and reports a rejected flag value through console.error", async () => {
  const errors: string[] = [];
  const error = spyOn(console, "error").mockImplementation((message) => {
    errors.push(String(message));
  });

  try {
    expect(await runCli(["new", "app", "--dry-run=abc"])).toBe(1);
    expect(await runCli(["generate", "controller", "user", "--crud=abc"])).toBe(1);
    expect(errors).toEqual([
      'Aponia CLI error: Option "--dry-run" does not accept a value.',
      'Aponia CLI error: Option "--crud" does not accept a value.',
    ]);
  } finally {
    error.mockRestore();
  }
});
