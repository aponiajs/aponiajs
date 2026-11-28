import { describe, expect, test } from "bun:test";
import { main as application } from "./lib/application/application.factory.ts";
import { main as classSchematic } from "./lib/class/class.factory.ts";
import { main as configuration } from "./lib/configuration/configuration.factory.ts";
import { main as controller } from "./lib/controller/controller.factory.ts";
import { main as decorator } from "./lib/decorator/decorator.factory.ts";
import { main as filter } from "./lib/filter/filter.factory.ts";
import { main as gateway } from "./lib/gateway/gateway.factory.ts";
import { main as guard } from "./lib/guard/guard.factory.ts";
import { main as interceptor } from "./lib/interceptor/interceptor.factory.ts";
import { main as interfaceSchematic } from "./lib/interface/interface.factory.ts";
import { main as library } from "./lib/library/library.factory.ts";
import { main as middleware } from "./lib/middleware/middleware.factory.ts";
import { main as moduleSchematic } from "./lib/module/module.factory.ts";
import { main as pipe } from "./lib/pipe/pipe.factory.ts";
import { main as provider } from "./lib/provider/provider.factory.ts";
import { main as resolver } from "./lib/resolver/resolver.factory.ts";
import { main as resource } from "./lib/resource/resource.factory.ts";
import { main as service } from "./lib/service/service.factory.ts";
import { main as subApp } from "./lib/sub-app/sub-app.factory.ts";
import { main as upgrade } from "./lib/upgrade/upgrade.factory.ts";
import type { SchematicFactory, SchematicOptions } from "./index.ts";

describe("the schematic factory contract", () => {
  test("renders a controller with the spec file beside it", async () => {
    const plan = await controller({ name: "UserProfile", path: "src" });
    const paths = plan.files.map((file) => file.path);

    expect(paths).toEqual([
      "src/user-profile/user-profile.controller.spec.ts",
      "src/user-profile/user-profile.controller.ts",
    ]);
    const source = plan.files.find((file) => file.path.endsWith("controller.ts"))?.content ?? "";
    expect(source).toContain("class UserProfileController");
  });

  test("honors flat, spec, and the spec suffix", async () => {
    const plan = await controller({
      name: "users",
      path: "src",
      flat: true,
      spec: false,
      specFileSuffix: "test",
    });

    expect(plan.files.map((file) => file.path)).toEqual(["src/users.controller.ts"]);
  });

  test("renders the Aponia CLI configuration", async () => {
    const plan = await configuration({
      name: "app",
      path: "",
      collection: "@aponiajs/schematics",
      sourceRoot: "apps/api/src",
    });

    expect(plan.files.map((file) => file.path)).toEqual(["aponia-cli.json"]);
    const content = plan.files[0]?.content ?? "";
    expect(content).toContain('"collection": "@aponiajs/schematics"');
    expect(content).toContain('"sourceRoot": "apps/api/src"');
  });

  test("renders the application and resource control blocks", async () => {
    const app = await application({
      name: "demo",
      path: "demo",
      type: "cjs",
      spec: true,
      observe: false,
      skills: [],
    });
    expect(app.files.length).toBeGreaterThan(0);
    for (const file of app.files) {
      expect(file.content).not.toContain("<%");
    }
    const manifest = app.files.find((file) => file.path.endsWith("package.json"))?.content ?? "";
    expect(manifest).toContain('"name": "demo"');
    expect(manifest).not.toContain("@nestjs/observe");

    const rest = await resource({
      name: "users",
      path: "src",
      type: "rest",
      crud: true,
      spec: false,
    });
    expect(rest.files.map((file) => file.path)).toContain("src/users/users.controller.ts");
    for (const file of rest.files) {
      expect(file.content).not.toContain("<%");
    }
  });

  test("refuses a missing name and an unsupported language", async () => {
    expect(() => controller({})).toThrow('Schematic "controller" requires a name.');
    expect(() => controller({ name: "users", language: "coffee" })).toThrow(
      'Schematic "controller" does not support "coffee".',
    );
    expect(() => resource({ name: "users", language: "js" })).toThrow(
      'The "resource" schematic does not support JavaScript language (only TypeScript is supported).',
    );
    expect(() => resource({ name: "users", language: "coffee" })).toThrow(
      'Schematic "resource" does not support "coffee".',
    );
  });

  test("renders the sub-application, library, and interface sets without directives", async () => {
    const plans = [
      await subApp({ name: "admin", path: "apps", spec: false }),
      await library({ name: "widgets", path: "libs", spec: false }),
      await interfaceSchematic({ name: "user-profile", path: "src" }),
    ];

    for (const plan of plans) {
      for (const file of plan.files) {
        expect(file.content).not.toContain("<%");
      }
    }

    const subService = plans[0]?.files.find((file) => file.path.endsWith("admin.service.ts"));
    expect(subService?.content).toContain("class AdminService");
    const libraryPaths = plans[1]?.files.map((file) => file.path) ?? [];
    expect(libraryPaths).toEqual(expect.arrayContaining(["libs/widgets/src/widgets.module.ts"]));
    expect(libraryPaths.some((path) => path.includes(".spec."))).toBe(false);
    expect(plans[2]?.files.map((file) => file.path)).toEqual([
      "src/user-profile/user-profile.interface.ts",
    ]);
    expect(plans[2]?.files[0]?.content).toContain("export interface UserProfile");
  });

  test("classifies before lower-casing a resource name", async () => {
    const plan = await resource({
      name: "user-profiles",
      path: "src",
      type: "rest",
      crud: true,
      spec: false,
    });
    const controller =
      plan.files.find((file) => file.path.endsWith("controller.ts"))?.content ?? "";

    expect(controller).toContain("private readonly userProfilesService: UserProfilesService");
  });

  test("drops the test runner's setup and the Claude guide when they are not requested", async () => {
    const withoutSpecs = await application({
      name: "demo",
      path: "demo",
      type: "esm",
      spec: false,
      skills: [],
    });
    const paths = withoutSpecs.files.map((file) => file.path);
    expect(paths).not.toContain("demo/test/app.e2e-spec.ts");
    expect(paths).not.toContain("demo/vitest.config.ts");
    expect(paths).not.toContain("demo/CLAUDE.md");

    const withClaude = await application({
      name: "demo",
      path: "demo",
      type: "esm",
      spec: true,
      skills: ["claude"],
    });
    expect(withClaude.files.map((file) => file.path)).toContain("demo/CLAUDE.md");
  });

  test("renders the minimal application only for the ESM template set", async () => {
    const minimal = await application({
      name: "mini",
      path: "mini",
      type: "esm",
      minimal: true,
      spec: true,
      skills: [],
    });
    expect(minimal.files.map((file) => file.path)).toContain("mini/src/main.ts");

    expect(() =>
      application({ name: "mini", type: "cjs", minimal: true, spec: true, skills: [] }),
    ).toThrow("A minimal application is ESM only");
    expect(() =>
      application({
        name: "mini",
        type: "esm",
        language: "js",
        minimal: true,
        spec: true,
        skills: [],
      }),
    ).toThrow("A minimal application is TypeScript only");
  });

  test("renders every published schematic factory", async () => {
    const component: SchematicOptions = { name: "sample", path: "src", spec: false };
    const cases: readonly (readonly [string, SchematicFactory, SchematicOptions])[] = [
      [
        "application",
        application,
        { name: "demo", path: "demo", type: "esm", spec: false, skills: [] },
      ],
      ["class", classSchematic, component],
      ["configuration", configuration, { path: ".", language: "ts" }],
      ["controller", controller, component],
      ["decorator", decorator, component],
      ["filter", filter, component],
      ["gateway", gateway, component],
      ["guard", guard, component],
      ["interceptor", interceptor, component],
      ["interface", interfaceSchematic, component],
      ["library", library, { name: "widgets", path: "libs", spec: false }],
      ["middleware", middleware, component],
      ["module", moduleSchematic, component],
      ["pipe", pipe, component],
      ["provider", provider, component],
      ["resolver", resolver, component],
      ["resource", resource, { ...component, type: "rest", crud: true }],
      ["service", service, component],
      ["sub-app", subApp, { name: "admin", path: "apps", spec: false }],
      ["upgrade", upgrade, {}],
    ];

    for (const [name, factory, options] of cases) {
      const plan = await factory(options);
      if (name === "upgrade") {
        expect(plan.files).toEqual([]);
        continue;
      }
      expect(plan.files.length, name).toBeGreaterThan(0);
      for (const file of plan.files) {
        expect(file.content, `${name}: ${file.path}`).not.toContain("<%");
      }
    }
  });
});
