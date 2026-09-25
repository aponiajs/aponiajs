import { expect, test } from "bun:test";
import { parseArguments } from "../src/commands/arguments.ts";

test("recognizes every help and version spelling as a complete command", () => {
  expect(parseArguments([])).toEqual({ command: "help" });
  expect(parseArguments(["help"])).toEqual({ command: "help" });
  expect(parseArguments(["--help"])).toEqual({ command: "help" });
  expect(parseArguments(["-h"])).toEqual({ command: "help" });
  expect(parseArguments(["version"])).toEqual({ command: "version" });
  expect(parseArguments(["--version"])).toEqual({ command: "version" });
  expect(parseArguments(["-v"])).toEqual({ command: "version" });
});

test("maps the project alias and rejects aliases the command does not declare", () => {
  expect(parseArguments(["g", "service", "users", "-p", "api"])).toMatchObject({ project: "api" });
  expect(() => parseArguments(["g", "service", "users", "-s"])).toThrow(
    'Unknown option "--skip-install".',
  );
  expect(() => parseArguments(["n", "sample-api", "-p", "api"])).toThrow(
    'Unknown option "--project".',
  );
  expect(() => parseArguments(["g", "service", "users", "-ds"])).toThrow('Unknown option "--ds".');
  expect(() => parseArguments(["g", "service", "users", "-papi"])).toThrow(
    'Unknown option "--papi".',
  );
});

test("keeps only the last value when a flag is supplied twice", () => {
  expect(
    parseArguments(["g", "service", "users", "--module", "admin", "--module", "public"]),
  ).toMatchObject({ module: "public" });
  expect(
    parseArguments(["g", "resource", "users", "--type", "rest", "--type", "ws"]),
  ).toMatchObject({ type: "ws" });
  expect(parseArguments(["g", "service", "users", "--no-spec", "--spec"])).toMatchObject({
    spec: true,
  });
  expect(parseArguments(["g", "service", "users", "--spec", "--no-spec"])).toMatchObject({
    spec: false,
  });
  expect(parseArguments(["g", "service", "users", "--flat", "--no-flat"])).toMatchObject({
    flat: false,
  });
  expect(parseArguments(["g", "service", "users", "-d", "--no-dry-run"])).toMatchObject({
    dryRun: false,
  });
});

test("rejects an attached value on a flag and a negated value option", () => {
  expect(() => parseArguments(["g", "service", "users", "--crud=false"])).toThrow(
    'Option "--crud" does not accept a value.',
  );
  expect(() => parseArguments(["g", "service", "users", "--flat=true"])).toThrow(
    'Option "--flat" does not accept a value.',
  );
  expect(() => parseArguments(["g", "service", "users", "--no-module"])).toThrow(
    'Option "--module" requires a value.',
  );
  expect(() => parseArguments(["g", "service", "users", "--no-type"])).toThrow(
    'Option "--type" requires a value.',
  );
  expect(() => parseArguments(["g", "service", "users", "--no-path"])).toThrow(
    'Option "--path" requires a value.',
  );
});

test("parses an option given without a value as empty and never as the next flag", () => {
  expect(parseArguments(["g", "service", "users", "--module"])).toMatchObject({ module: "" });
  expect(parseArguments(["g", "service", "users", "--path"])).toMatchObject({ path: "" });
  expect(parseArguments(["g", "service", "users", "--module", "-d"])).toMatchObject({
    module: "",
    dryRun: true,
  });
  expect(() => parseArguments(["g", "service", "users", "--type"])).toThrow(
    'Unknown resource transport "".',
  );
  expect(() => parseArguments(["g", "service", "users", "--type", ""])).toThrow(
    'Unknown resource transport "".',
  );
});

test("accepts a resource transport on a schematic that does not consume it", () => {
  expect(parseArguments(["g", "module", "billing", "--type", "ws"])).toMatchObject({
    schematic: "module",
    type: "ws",
  });
});

test("defers a whitespace-only name to the downstream naming guards", () => {
  expect(parseArguments(["g", "service", "   "])).toMatchObject({ name: "   " });
  expect(parseArguments(["n", "   "])).toMatchObject({ name: "   " });
});
