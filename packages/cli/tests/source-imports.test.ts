import { describe, expect, test } from "bun:test";
import { Node } from "ts-morph";
import {
  collectSourceImports,
  parseSourceExpression,
  readExpressionImports,
} from "../src/generation/source-imports.ts";
import type { SourceImportsReading } from "../src/index.ts";

/**
 * The names one file can read, which every expression case below is read
 * against. It covers one binding of every form, and the local declarations that
 * are deliberately absent because nothing outside the file can name them.
 */
const catalog = collectSourceImports(
  `import Default from "./default.ts";
import * as shared from "./shared.ts";
import { Token, alias as renamed, type U } from "./tokens.ts";
import type { Shape } from "./shape.ts";

const hidden = 1;
class Hidden {}

export const Local = 1, Other = 2;
export function make(): void {}
export default class Exported {}
export { renamed as reExported };
`,
  "/app/src/mod.ts",
);

/** Reads one copy's text the way the descriptor emitter reads a schema or a provider. */
function read(text: string): SourceImportsReading {
  return readExpressionImports(parseSourceExpression(text), catalog, "The copy");
}

/** The names a copy reads, which is what a generated module has to import. */
function reads(text: string): readonly string[] {
  return read(text).references.map((reference) => reference.name);
}

describe("collectSourceImports", () => {
  test("reads every binding form an import declaration writes, and the names the file exports", () => {
    expect([...catalog.values()]).toStrictEqual([
      {
        name: "Default",
        exportedName: "default",
        specifier: "/app/src/default.ts",
        form: "default",
        kind: "value",
      },
      {
        name: "shared",
        exportedName: "shared",
        specifier: "/app/src/shared.ts",
        form: "namespace",
        kind: "value",
      },
      {
        name: "Token",
        exportedName: "Token",
        specifier: "/app/src/tokens.ts",
        form: "named",
        kind: "value",
      },
      {
        name: "renamed",
        exportedName: "alias",
        specifier: "/app/src/tokens.ts",
        form: "named",
        kind: "value",
      },
      {
        name: "U",
        exportedName: "U",
        specifier: "/app/src/tokens.ts",
        form: "named",
        kind: "type",
      },
      {
        name: "Shape",
        exportedName: "Shape",
        specifier: "/app/src/shape.ts",
        form: "named",
        kind: "type",
      },
      {
        name: "Exported",
        exportedName: "default",
        specifier: "/app/src/mod.ts",
        form: "default",
        kind: "value",
      },
      {
        name: "make",
        exportedName: "make",
        specifier: "/app/src/mod.ts",
        form: "named",
        kind: "value",
      },
      {
        name: "Local",
        exportedName: "Local",
        specifier: "/app/src/mod.ts",
        form: "named",
        kind: "value",
      },
      {
        name: "Other",
        exportedName: "Other",
        specifier: "/app/src/mod.ts",
        form: "named",
        kind: "value",
      },
    ]);
  });

  test("keeps a bare specifier as written and leaves a name the file does not export out", () => {
    const imports = collectSourceImports(
      `import { t } from "elysia";

export const readable = t.Object({});
const privateValue = 1;
class PrivateClass {}
`,
      "/app/src/values.ts",
    );

    expect([...imports.values()]).toStrictEqual([
      { name: "t", exportedName: "t", specifier: "elysia", form: "named", kind: "value" },
      {
        name: "readable",
        exportedName: "readable",
        specifier: "/app/src/values.ts",
        form: "named",
        kind: "value",
      },
    ]);
    expect(imports.has("privateValue")).toBe(false);
    expect(imports.has("PrivateClass")).toBe(false);
  });
});

describe("readExpressionImports", () => {
  test("reads a copy's names once each in first-use order, a type-only name included", () => {
    expect(reads("((one: U, two: Token) => [one, two, one, Token])")).toStrictEqual(["U", "Token"]);
    expect(read("((one: U, two: Token) => [one, two])").unreadable).toBeUndefined();
  });

  test("does not report a parameter the copy binds, whichever binding pattern writes it", () => {
    expect(
      reads("((input: { readonly token: Token }, { id }: Shape) => input.token)"),
    ).toStrictEqual(["Token", "Shape"]);
    expect(reads("([first, ...rest]: Shape) => first")).toStrictEqual(["Shape"]);
    expect(reads("([, second]: { readonly a: U }) => second")).toStrictEqual(["U"]);
    expect(reads("((one: U = Token) => one)")).toStrictEqual(["U", "Token"]);
  });

  test("does not report a variable, catch binding, or label the copy's own declaration introduces", () => {
    expect(reads("(() => { const local = Token; return 1; })")).toStrictEqual(["Token"]);
    expect(reads("(() => { const local: U = Token; return 1; })")).toStrictEqual(["U", "Token"]);
    expect(
      reads("(() => { try { return Token; } catch (error) { return error; } })"),
    ).toStrictEqual(["Token"]);
    expect(reads("(() => { try { return Token; } catch { return Token; } })")).toStrictEqual([
      "Token",
    ]);
    expect(reads("(() => { outer: for (;;) { break outer; } })")).toStrictEqual([]);
  });

  test("does not report a member name, which names a property rather than a binding", () => {
    expect(reads("({ body: Local, query: Token })")).toStrictEqual(["Local", "Token"]);
    expect(reads("({ Local })")).toStrictEqual(["Local"]);
    expect(reads("((input: { body: U }) => input)")).toStrictEqual(["U"]);
    expect(reads("((input: { method(): U }) => input)")).toStrictEqual(["U"]);
    expect(
      reads(
        "(class { readonly token = Token; method(one: U) {} get other() { return Token; } set other(value: U) {} })",
      ),
    ).toStrictEqual(["Token", "U"]);
  });

  test("reads the target of a property access or a qualified name, never its member", () => {
    expect(reads("shared.Input")).toStrictEqual(["shared"]);
    expect(reads("((input: shared.Input) => input)")).toStrictEqual(["shared"]);
    expect(reads("(Token.name)")).toStrictEqual(["Token"]);
    expect(reads("(Default)")).toStrictEqual(["Default"]);
    expect(reads("(renamed)")).toStrictEqual(["renamed"]);
  });

  test("reports a name the file cannot read, keeping the names it could", () => {
    expect(read("((input: Token, two: Hidden) => input)")).toStrictEqual({
      references: [
        {
          name: "Token",
          exportedName: "Token",
          specifier: "/app/src/tokens.ts",
          form: "named",
          kind: "value",
        },
      ],
      unreadable:
        'The copy reads "Hidden", which is not an import or an export of the file it was written in, ' +
        "so a generated module cannot name it.",
    });
  });

  test("reports the first unreadable name only, so one reason explains one decline", () => {
    expect(read("((one: Missing, two: Hidden) => [one, two])")).toStrictEqual({
      references: [],
      unreadable:
        'The copy reads "Missing", which is not an import or an export of the file it was written in, ' +
        "so a generated module cannot name it.",
    });
  });

  test("refuses a type-only binding in a value position", () => {
    expect(reads("((value: U) => value)")).toStrictEqual(["U"]);
    expect(reads("((value: Token): U => value)")).toStrictEqual(["Token", "U"]);
    expect(read("(U)")).toStrictEqual({
      references: [],
      unreadable: 'The copy reads "U" as a value, but the file imports it as a type.',
    });
  });

  test("refuses a copy whose own declaration is a sibling or its own name, never claiming it", () => {
    // A declaration inside the copied text binds only the statements it
    // encloses, never its siblings: `return local` below is answered against
    // the file's own imports, and a local name the file cannot import is
    // reported rather than assumed to be the declaration beside it.
    expect(read("(() => { const local = 1; return local; })")).toStrictEqual({
      references: [],
      unreadable:
        'The copy reads "local", which is not an import or an export of the file it was written in, ' +
        "so a generated module cannot name it.",
    });
    expect(read("(function named(one: U) { return one; })").unreadable).toBe(
      'The copy reads "named", which is not an import or an export of the file it was written in, ' +
        "so a generated module cannot name it.",
    );
    expect(read("(class Hidden {})").unreadable).toBe(
      'The copy reads "Hidden", which is not an import or an export of the file it was written in, ' +
        "so a generated module cannot name it.",
    );
  });
});

describe("parseSourceExpression", () => {
  test("answers for the text itself, not for the statement that wraps it", () => {
    const object = parseSourceExpression("{ body: 1 }");
    expect(Node.isObjectLiteralExpression(object)).toBe(true);
    expect(object.getText()).toBe("{ body: 1 }");

    const identifier = parseSourceExpression("Token");
    expect(Node.isIdentifier(identifier)).toBe(true);
    expect(identifier.getText()).toBe("Token");

    const binary = parseSourceExpression("1 + 1");
    expect(Node.isBinaryExpression(binary)).toBe(true);

    const classExpression = parseSourceExpression("class C {}");
    expect(Node.isClassExpression(classExpression)).toBe(true);

    const template = parseSourceExpression("`${Token}`");
    expect(Node.isTemplateExpression(template)).toBe(true);
  });
});
