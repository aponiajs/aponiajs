import { expect, test } from "bun:test";
import { parseArguments } from "../src/index.ts";

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
  ).toEqual({
    command: "generate",
    schematic: "controller",
    name: "user",
    dryRun: false,
    skipImport: false,
    path: "src/users",
    module: "app",
    project: "api",
    crud: true,
    type: "rest",
  });
});
