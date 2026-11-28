import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyControlBlocks,
  createSchematicFactory,
  evaluateCondition,
  renderTemplate,
  type RenderTemplatesOptions,
} from "./lib/schematic.factory.ts";
import {
  defaultCollectionPackage,
  parseFactoryReference,
  readCollection,
  resolveCollectionEntry,
} from "./index.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function renderOptions(options: RenderTemplatesOptions["options"] = {}): RenderTemplatesOptions {
  return {
    templateRoot: "",
    outputRoot: "",
    name: "sample",
    spec: true,
    specFileSuffix: "spec",
    options,
  };
}

describe("the collection reader", () => {
  test("reads a published collection and resolves names and aliases", async () => {
    const root = await mkdtemp(join(tmpdir(), "aponia-collection-read-"));
    temporaryDirectories.push(root);
    await Bun.write(
      join(root, "collection.json"),
      JSON.stringify({
        schematics: {
          controller: {
            factory: "./controller.js#main",
            description: "controller",
            aliases: ["co"],
          },
          plain: { factory: "./plain.js", description: "no schema" },
        },
      }),
    );

    const collection = await readCollection(root);
    expect(resolveCollectionEntry(collection, "controller")?.entry.description).toBe("controller");
    expect(resolveCollectionEntry(collection, "co")?.name).toBe("controller");
    expect(resolveCollectionEntry(collection, "missing")).toBeUndefined();
    expect(parseFactoryReference("./controller.js#main")).toEqual({
      path: "./controller.js",
      exportName: "main",
    });
    expect(parseFactoryReference("./plain.js")).toEqual({
      path: "./plain.js",
      exportName: "main",
    });
    expect(defaultCollectionPackage).toBe("@aponiajs/schematics");
  });

  test("refuses a package with no collection", () => {
    expect(readCollection("/definitely/missing")).rejects.toThrow(
      'No collection.json found in "/definitely/missing".',
    );
  });
});

describe("the template control blocks", () => {
  test("renders if, else, and else-if branches", () => {
    expect(applyControlBlocks("a<% if (spec) { %>b<% } %>c", renderOptions())).toBe("abc");
    expect(
      applyControlBlocks("a<% if (minimal) { %>b<% } else { %>c<% } %>d", renderOptions()),
    ).toBe("acd");
    expect(
      applyControlBlocks(
        "a<% if (minimal) { %>b<% } else if (observe) { %>c<% } else { %>d<% } %>e",
        renderOptions({ observe: true }),
      ),
    ).toBe("ace");
  });

  test("renders nested conditions and leaves value substitutions for the renderer", () => {
    expect(
      applyControlBlocks(
        "<% if (spec) { %>x<% if (crud) { %>y<% } %><% } %>z",
        renderOptions({ crud: false }),
      ),
    ).toBe("xz");
    expect(applyControlBlocks("<%= name %>", renderOptions())).toBe("<%= name %>");
    expect(applyControlBlocks("<%# comment %>kept", renderOptions())).toBe("kept");
  });

  test("refuses an unbalanced or unsupported directive", () => {
    expect(() => applyControlBlocks("<% } %>", renderOptions())).toThrow(
      'Template directive "}" has no open condition.',
    );
    expect(() => applyControlBlocks("<% } else { %>", renderOptions())).toThrow(
      'Template directive "} else" has no open condition.',
    );
    expect(() => applyControlBlocks("<% } else if (spec) { %>", renderOptions())).toThrow(
      'Template directive "} else if" has no open condition.',
    );
    expect(() => applyControlBlocks("<% for (x of y) { %>", renderOptions())).toThrow(
      'Unsupported template directive "<%for (x of y) {%>".',
    );
  });

  test("refuses an expression the template values do not define", () => {
    expect(() => renderTemplate("<%= unknown %>", renderOptions())).toThrow(
      'Unsupported template expression "unknown".',
    );
    expect(renderTemplate("<%= classify(name)%>", renderOptions())).toBe("Sample");
  });

  test("evaluates the template conditions and refuses an unknown expression", () => {
    expect(evaluateCondition("spec", renderOptions())).toBe(true);
    expect(evaluateCondition("(!minimal)", renderOptions())).toBe(true);
    expect(evaluateCondition("(skills.length)", renderOptions({ skills: ["cursor"] }))).toBe(true);
    expect(
      evaluateCondition(
        "(type === 'microservice' || type === 'ws') && crud",
        renderOptions({ type: "ws", crud: false }),
      ),
    ).toBe(false);
    expect(() => evaluateCondition("unknownCondition", renderOptions())).toThrow(
      'Unsupported template condition "unknownCondition".',
    );
  });
});

describe("the factory definition", () => {
  test("renders the JavaScript template set and the ESM application set", async () => {
    const controller = createSchematicFactory({ schematic: "controller", nestByName: true });
    const js = await controller({ name: "users", language: "js", spec: false });
    expect(js.files.map((file) => file.path)).toEqual(["users/users.controller.js"]);

    const application = createSchematicFactory({
      schematic: "application",
      templateDirectory: (options) => (options.type === "esm" ? "files/ts-esm" : "files/ts"),
    });
    const esm = await application({ name: "demo", type: "esm", spec: false });
    expect(esm.files.some((file) => file.path.endsWith("main.ts"))).toBe(true);
  });
});
