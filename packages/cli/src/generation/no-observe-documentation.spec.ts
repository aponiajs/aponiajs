import { expect, test } from "bun:test";
import { stripDevtoolsDocumentation } from "./no-observe-documentation.ts";

test("leaves a file the starter does not document as devtools unchanged", () => {
  const source = "export const value = 1;\n";

  expect(stripDevtoolsDocumentation("src/main.ts", source)).toBe(source);
});

test("removes the devtools lines from the generated index", () => {
  const index = [
    "# sample-api",
    "",
    "- [Devtools](https://example.test/devtools.md): the surface",
    "- [@aponiajs/devtools](https://www.npmjs.com/package/@aponiajs/devtools): the module",
    "- [@aponiajs/common](https://www.npmjs.com/package/@aponiajs/common): the contracts",
    "",
  ].join("\n");

  expect(stripDevtoolsDocumentation("llms.txt", index)).toBe(
    [
      "# sample-api",
      "",
      "- [@aponiajs/common](https://www.npmjs.com/package/@aponiajs/common): the contracts",
      "",
    ].join("\n"),
  );
});

test("fails by name when the README no longer carries the devtools paragraphs", () => {
  expect(() => stripDevtoolsDocumentation("README.md", "# sample-api\n")).toThrow(
    "The no-observe documentation transform no longer finds the block it rewrites.",
  );
});

test("fails by name when the README artifact block is present but the surface is not", () => {
  const readme =
    " The\ndescriptor artifact this starter commits also holds no declaration for the root.\n" +
    "Nothing is missing: the decorated graph still mounts the devtools surface.\n";

  expect(() => stripDevtoolsDocumentation("README.md", readme)).toThrow(
    "The no-observe README transform no longer finds the devtools surface section.",
  );
});

test("fails by name when the agent guide no longer carries the devtools heading", () => {
  const guide =
    "That artifact holds no declaration for `AppModule` in this starter, because `aponia build`\n" +
    "cannot lower it. `aponia build` writes the same two modules without bundling.\n";

  expect(() => stripDevtoolsDocumentation("AGENTS.md", guide)).toThrow(
    'The no-observe guide transform no longer finds the "## Devtools" section it removes.',
  );
});

test("fails by name when the environment sample no longer carries the devtools block", () => {
  expect(() => stripDevtoolsDocumentation(".env.example", "PORT=3000\n")).toThrow(
    "The no-observe .env.example transform no longer finds its devtools block.",
  );
});

test("fails by name when the logger no longer carries its documentation block", () => {
  expect(() => stripDevtoolsDocumentation("src/logger.ts", "export const value = 1;\n")).toThrow(
    "The no-observe logger transform no longer finds its documentation block.",
  );
});
