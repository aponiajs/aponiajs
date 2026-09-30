import { expect, test } from "bun:test";
import { Controller, Get, Module } from "@aponiajs/common";
import { Elysia, type AnyElysia } from "elysia";
import {
  AponiaFactory,
  ElysiaPluginModule,
  type AponiaApplicationOptions,
  type NativeElysiaPlugin,
} from "../src/index.ts";

@Controller("app-plugins-health")
class HealthController {
  @Get("ping")
  ping(): string {
    return "pong";
  }
}

@Module({ controllers: [HealthController] })
class PluginOptionsModule {}

/**
 * A plugin whose one route answers with the string it was built for, so a case
 * reads which plugin served a request rather than a bare status.
 */
function answeringPlugin(name: string, answer: string): Elysia {
  return new Elysia({ name }).get(`/${name}`, () => answer);
}

/** The phase a plugin mounted through each path observed, in arrival order. */
function observingPlugin(name: string, phases: string[]): Elysia {
  return new Elysia({ name })
    .request(() => {
      phases.push(`request:${name}`);
    })
    .afterResponse("global", () => {
      phases.push(`after:${name}`);
    });
}

test("a plugin supplied by the option is mounted on the root application", async () => {
  const application = await AponiaFactory.create(PluginOptionsModule, {
    logger: false,
    plugins: [answeringPlugin("from-option", "option")],
  });

  const answered = await application.handle(new Request("http://localhost/from-option"));
  const controllerRoute = await application.handle(
    new Request("http://localhost/app-plugins-health/ping"),
  );

  expect(answered.status).toBe(200);
  expect(await answered.text()).toBe("option");
  // The controllers still mount, so the option adds to the boot rather than
  // replacing what the module graph contributes.
  expect(await controllerRoute.text()).toBe("pong");
  await application.close();
});

test("an undefined entry mounts nothing, so the plugin it stands for is absent", async () => {
  const plugins: readonly (NativeElysiaPlugin | undefined)[] = [
    answeringPlugin("present", "present"),
    undefined,
  ];
  const application = await AponiaFactory.create(PluginOptionsModule, {
    logger: false,
    plugins,
  });

  const present = await application.handle(new Request("http://localhost/present"));
  const absent = await application.handle(new Request("http://localhost/absent-stand-in"));

  expect(await present.text()).toBe("present");
  // The absence is Elysia's own 404 rather than a route that answered nothing:
  // a mounted plugin contributes a route whatever it returns, so a status here
  // would mean the entry was mounted after all.
  expect(absent.status).toBe(404);
  await application.close();
});

test("an omitted option and an empty list both mount no plugin", async () => {
  const withoutOption = await AponiaFactory.create(PluginOptionsModule, { logger: false });
  const withEmptyList = await AponiaFactory.create(PluginOptionsModule, {
    logger: false,
    plugins: [],
  });

  for (const application of [withoutOption, withEmptyList]) {
    const response = await application.handle(
      new Request("http://localhost/app-plugins-health/ping"),
    );

    expect(response.status).toBe(200);
    await application.close();
  }
});

/** Waits for the after-response phase, which runs once the answer was written. */
async function waitForPhases(phases: readonly string[], count: number): Promise<void> {
  for (let attempt = 0; attempt < 100 && phases.length < count; attempt += 1) {
    await Bun.sleep(10);
  }
}

test("the application's own plugins are the outer ones", async () => {
  const phases: string[] = [];
  const optionPlugin = observingPlugin("option", phases);
  const modulePlugin = observingPlugin("module", phases);

  @Module({ imports: [ElysiaPluginModule.register(modulePlugin, { key: "observed" })] })
  class ObservedModule {}

  const application = await AponiaFactory.create(ObservedModule, {
    logger: false,
    plugins: [optionPlugin],
  });

  try {
    // A real request rather than `handle()`: the after-response phase is the
    // one that runs once the answer reached a socket, so `handle()` would
    // observe half the order. The port is the socket's, read back from the
    // application that bound it.
    await application.listen(0);
    await fetch(`${application.getUrl()}/nowhere`);
    await waitForPhases(phases, 4);

    // The rows are hook order, which is the only observable of mount order, and
    // they are one list because both phases are asserted here rather than one
    // per case: the option's plugin runs first in both of them. Nothing is
    // reversed between the phases, which is the fact that would otherwise be
    // assumed — a middleware that wrapped the later one would reach the after
    // phase last.
    expect(phases).toEqual(["request:option", "request:module", "after:option", "after:module"]);
  } finally {
    await application.close();
  }
});

test("the option is never mutated by the boot", async () => {
  const plugin = answeringPlugin("frozen-entry", "frozen");
  const options: AponiaApplicationOptions = {
    logger: false,
    plugins: Object.freeze([plugin]),
  };

  const application = await AponiaFactory.create(PluginOptionsModule, options);
  const response = await application.handle(new Request("http://localhost/frozen-entry"));

  expect(await response.text()).toBe("frozen");
  expect(options.plugins).toEqual([plugin]);
  await application.close();
});

test("a plugin mounted by the option reaches the native application unchanged", async () => {
  const plugin: Elysia = answeringPlugin("native-identity", "identity");
  const application = await AponiaFactory.create(PluginOptionsModule, {
    logger: false,
    plugins: [plugin],
  });
  const nativeApplication: AnyElysia = application.getNativeApplication();

  // The identity is what makes "mounted beside the module plugins" a fact about
  // the application rather than a claim: this is the instance the option named,
  // composed into the root the boot returns.
  expect(nativeApplication.routes.map((route) => route.path)).toContain("/native-identity");
  await application.close();
});
