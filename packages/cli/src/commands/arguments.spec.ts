import { expect, test } from "bun:test";
import { parseArguments } from "../index.ts";

test.each(["--no-path", "--no-module", "--no-project", "--no-type"])(
  "rejects %s because a value option cannot be negated",
  (option) => {
    expect(() => parseArguments(["generate", "controller", "user", option])).toThrow(
      `Option "--${option.replace("--no-", "")}" requires a value.`,
    );
  },
);

test("rejects the negated short alias of a value option", () => {
  expect(() => parseArguments(["generate", "controller", "user", "--no-p"])).toThrow(
    'Option "--project" requires a value.',
  );
});

test("accepts the same options when they carry an explicit value", () => {
  expect(
    parseArguments([
      "generate",
      "controller",
      "user",
      "--path=src/users",
      "--module=app",
      "--project=api",
      "--type=rest",
    ]),
  ).toMatchObject({
    command: "generate",
    schematic: "controller",
    name: "user",
    dryRun: false,
    flat: undefined,
    skipImport: false,
    path: "src/users",
    module: "app",
    project: "api",
    spec: undefined,
    crud: true,
    type: "rest",
    publish: false,
    scope: undefined,
    skipInstall: false,
    interactive: true,
  });
});

test("parses the upgrade alias into the generate command it shares", () => {
  const command = parseArguments(["update"]);

  expect(command).toMatchObject({ command: "generate", schematic: "upgrade" });
});

test("refuses each command shape the parser cannot accept", () => {
  const cases: readonly [readonly string[], string][] = [
    [["build", "--all", "app"], 'Option "--all" cannot be combined with a project name.'],
    [["add"], "A package name is required."],
    [["add", "left-pad", "extra"], 'Unexpected argument "extra".'],
    [["start", "one", "two"], 'Unexpected argument "two".'],
    [["info", "extra"], 'Unexpected argument "extra".'],
    [
      ["library", "nope"],
      'The library command requires the "new", "check", "publish", or "search" action.',
    ],
    [["library", "check", "one", "two"], 'Unexpected argument "two".'],
    [["library", "new"], "Library name is required."],
    [["library", "check", "--kind", "plugin"], 'Option "--kind" is only valid with "library new".'],
    [["agent", "nope"], 'The agent command requires the "init" action.'],
    [["agent", "init", "extra"], 'Unexpected argument "extra".'],
    [["new", "app", "--type", "deno"], 'Option "--type" must be "bun", "esm", or "cjs".'],
    [
      ["new", "app", "--test-runner", "mocha"],
      'Option "--test-runner" must be "bun", "vitest", or "jest".',
    ],
    [
      ["generate", "resource", "users", "--language", "python"],
      'Option "--language" must be "ts" or "js".',
    ],
    [["generate", "resource", "users", "--type", "soap"], 'Unknown resource transport "soap".'],
    [["build", "--tsc", "--swc"], "Use one builder flag at a time; received tsc, swc."],
    [
      ["build", "--webpack"],
      'The "webpack" builder is not supported by the Aponia CLI. Use "tsc" or "swc": both map to the workspace\'s Bun/Vite+ build.',
    ],
    [["build", "--builder", "esbuild"], 'Unknown builder "esbuild". Use "tsc" or "swc".'],
  ];

  for (const [arguments_, message] of cases) {
    expect(() => parseArguments(arguments_)).toThrow(message);
  }
});

test("accepts the language and builder spellings it normalizes", () => {
  expect(
    parseArguments(["generate", "resource", "users", "--language", "typescript"]),
  ).toMatchObject({ language: "ts" });
  expect(
    parseArguments(["generate", "resource", "users", "--language", "javascript"]),
  ).toMatchObject({ language: "js" });
  expect(parseArguments(["build", "--tsc"])).toMatchObject({ builder: "tsc" });
  expect(parseArguments(["build", "--builder", "swc"])).toMatchObject({ builder: "swc" });
});
