# Example Applications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two example applications `examples/` is missing for topics that have
shipped — `configuration` and `devtools` — each runnable on its own port with
end-to-end tests, and register both everywhere this repository enumerates examples.

**Architecture:** An example is an application built _with_ the framework, so it
follows the application conventions in `docs/architecture-and-style.md` rather than the
framework-repository layout. Both new examples keep the shape every existing one has —
`src/app.module.ts` composes, `src/main.ts` bootstraps, `test/application.ts` holds the
request helpers, `test/*.e2e-spec.ts` asserts the topic — and both resolve `@aponiajs/*`
to workspace sources through their own `tsconfig.json` `paths`, which is how every other
example runs against the tree instead of a built `dist`.

**Tech Stack:** TypeScript (strict, ESM, decorators), Bun test, Elysia 1.4.30,
`zod@^4.4.3` (the version `examples/validation` and the starter already use).

**Spec:** `examples/AGENTS.md` is the convention of record — one directory per topic,
the shared shape, and the two registrations a new example owes. `docs/configuration.md`
and `docs/devtools.md` are the behavior of record for what each example demonstrates;
`docs/superpowers/specs/2026-09-27-aponia-configuration-design.md` and
`docs/superpowers/specs/2026-09-26-aponia-devtools-design.md` are their designs.

## What the convention leaves to this plan, settled before Task 1

1. **Ports 3100 and 3110** are the next two after `lifecycle`'s 3090. The index's rows
   and the guide's list are in port order, so both append; the root manifest's
   `example:*` scripts are alphabetical, so `configuration` sorts after `basic` and
   `devtools` after `descriptors`.
2. **No test binds a fixed port.** The devtools example needs a second socket that the
   plugin binds on its own, so `test/application.ts` reserves both ports from the OS and
   releases them before the boot, which is exactly what
   `examples/websockets/test/application.ts` already does for one. `RULES.md` forbids
   fixed ports in a lane, and an example's suite is a lane.
3. **One logger object, handed to both.** `devtoolsPlugin` patches the logger it is
   handed so `/__devtools/logs` can serve what the application wrote, and
   `AponiaFactory.create` writes every bootstrap line through the logger it is handed.
   `src/logger.ts` exists to hold that one object, as the starter's does — and the
   example's test hands its own recording logger to both, so the `/logs` case asserts on
   a line the boot really wrote rather than on console output.
4. **No learn chapter is added, and no chapter gains an example link.** Measured: no
   chapter in `docs/learn/` mentions an example at all, so a link from one chapter would
   invent a convention rather than follow one. What the new directories change is
   `docs/learn/01-overview.md`'s sentence — the chapters without an example are named as
   errors, testing, releasing, and enhancers, and chapter 14 devtools was the one topic
   outside that list without one. Adding the devtools example makes that sentence true;
   it is checked in Task 3 rather than edited.
5. **Neither example carries `aponia.json`, `scripts/`, or generated artifacts.** They
   are applications to read and run, not starters the generator produced, and every
   existing example is the same. The consequence is deliberate and asserted: with no
   project analysis to read, `/__devtools/aot` answers the boot's own record and states
   why, which is the documented degraded half of that endpoint.
6. **Nothing about the framework changes.** This plan adds applications and the
   registers that list them; no `packages/**` file is touched, so no contract, no
   conformance lane, and no coverage floor moves.

## Global Constraints

- Every file, comment, and document is English. Before finishing a task:
  `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`
- **Branch `feature/example-applications`, cut from `release/alpha`** (`adfa527`). No
  push and no version bump until Task 3, which does both as one step.
- Examples import workspace packages by package name and never reach into another
  package's `src/` — the `tsconfig.json` `paths` are what point at sources.
- A new example owes `example:<name>` in the root manifest, a row in
  `examples/README.md`, and its name in `examples/AGENTS.md`'s list. All three are in
  the task that creates the example.
- `vitest`-shaped configuration stays out: an example ships `vite.config.ts` exactly as
  its neighbours do, so `bun run check` reads it the same way.
- Gates per task: `bun run check`, `bun run --cwd examples/<name> test`, then
  `bun run test:examples` once the second example exists. `bun run build` builds
  examples too, so a stale example breaks it.
- Commit bodies explain why the change is right and end with
  `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- Markdown tables are formatter-owned: `bun run check --fix`, then re-verify.

## Review Focus

Five ways this change is most likely to bite, each pinned by a case in the task named.

1. **A test that binds a fixed port.** The devtools example needs two sockets and the
   obvious shortcut is a literal `8000`; the suite would then collide with a developer's
   running devtools and with a parallel lane. (Task 2, `reservePort` in
   `test/application.ts`.)
2. **A `/logs` case that passes because the test's logger is the tapped one, not the
   application's.** The trap the starter documents is handing two different objects to
   the factory and the plugin, and a test that does that would pass while the example
   itself is wrong. (Task 2, the `/logs` case asserts the wrapper's own start line.)
3. **A disabled registration asserted on a port something else may have taken.** The
   point of `enabled: false` is that no socket exists; the case must fail for the
   refusal, not for an unrelated listener. (Task 2, `enabled: false` case reads the
   reserved port back.)
4. **A configuration suite that depends on the machine it runs on.** The example reads
   the process environment by design, so a test that does not set and restore it passes
   locally and fails in CI. (Task 1, `createApplication` saves and restores every key it
   touches.)
5. **A README that promises an endpoint behavior the degraded path does not do.**
   Without a project analysis, `/aot` answers less than its full payload; the README and
   the case have to say the same thing. (Task 2, the `/aot` case and the README's
   endpoint list.)

---

### Task 1: `examples/configuration`

**Files:**

- Create: `examples/configuration/package.json`
- Create: `examples/configuration/tsconfig.json`
- Create: `examples/configuration/vite.config.ts`
- Create: `examples/configuration/src/config.ts`
- Create: `examples/configuration/src/app.service.ts`
- Create: `examples/configuration/src/app.controller.ts`
- Create: `examples/configuration/src/app.module.ts`
- Create: `examples/configuration/src/main.ts`
- Create: `examples/configuration/test/application.ts`
- Create: `examples/configuration/test/configuration.e2e-spec.ts`
- Create: `examples/configuration/README.md`
- Modify: `package.json:19-28` (the `example:*` scripts)
- Modify: `examples/README.md:8-19` (the table)
- Modify: `examples/AGENTS.md:5-9` (the list of directories)
- Modify: `docs/configuration.md:195-203` (the Documentation block)

**Interfaces:**

- Consumes: `defineConfiguration` from `@aponiajs/common`; `provideConfiguration` and
  `AponiaFactory` from `@aponiajs/platform-elysia`; `application.get(token)`.
- Produces: `AppConfig`, a `ConfigurationToken<{ port: number; serviceName: string }>`
  exported from `src/config.ts`, and `createApplication(env)` / `get(application, path)`
  from `test/application.ts`.

- [ ] **Step 1: Cut the branch, then create the package manifest, tsconfig, and formatter config**

```bash
git fetch origin
git checkout -b feature/example-applications origin/release/alpha
git add docs/superpowers/plans/2026-09-28-aponia-example-applications.md
git commit -m "docs(examples): plan the two example applications this set is missing"
```

This plan travels on the branch it describes, which is how every plan in this repository
is committed: the record of a change and the change land together.

`examples/configuration/package.json`:

```json
{
  "name": "@aponiajs/example-configuration",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/main.ts",
    "build": "bun build ./src/main.ts --outdir ./dist --target bun",
    "test": "bun test ../../examples/configuration/test/*.e2e-spec.ts",
    "check": "vp check"
  },
  "dependencies": {
    "@aponiajs/common": "workspace:*",
    "@aponiajs/core": "workspace:*",
    "@aponiajs/platform-elysia": "workspace:*",
    "elysia": "^1.4.30",
    "zod": "^4.4.3"
  }
}
```

`examples/configuration/tsconfig.json` — the neighbours' file with nothing changed but
the `paths` it needs:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext"],
    "moduleDetection": "force",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "types": ["bun"],
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "noUnusedLocals": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "paths": {
      "@aponiajs/common": ["../../packages/common/src/index.ts"],
      "@aponiajs/core": ["../../packages/core/src/index.ts"],
      "@aponiajs/platform-elysia": ["../../packages/platform-elysia/src/index.ts"]
    }
  }
}
```

`examples/configuration/vite.config.ts`:

```ts
import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
```

- [ ] **Step 2: Write the failing test**

`examples/configuration/test/application.ts`:

```ts
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

/**
 * Boots the example against an environment the test chooses.
 *
 * The application validates the process environment, which is the point of the
 * example and the reason a test cannot use it as it stands: the suite would then
 * assert the machine it runs on. Every key is saved and restored, and the restore
 * happens as soon as the boot has read it — a value read once at boot is the
 * claim, so nothing here needs the environment afterwards.
 */
export async function createApplication(
  env: Readonly<Record<string, string | undefined>>,
): Promise<AponiaElysiaApplication> {
  const saved = new Map(Object.keys(env).map((key) => [key, process.env[key]]));

  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    return await AponiaFactory.create(AppModule, { logger: false });
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export function get(application: AponiaElysiaApplication, path: string): Promise<Response> {
  return Promise.resolve(application.handle(new Request(`http://localhost${path}`)));
}
```

`examples/configuration/test/configuration.e2e-spec.ts`:

```ts
import { afterEach, expect, test } from "bun:test";
import { AponiaError } from "@aponiajs/common";
import type { AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { AppConfig } from "../src/config.ts";
import { createApplication, get } from "./application.ts";

const defaultServiceName = "aponia-example-configuration";

let application: AponiaElysiaApplication | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

test("injects the value the schema produced, not the record it read", async () => {
  application = await createApplication({ PORT: "3121" });

  const response = await get(application, "/");

  expect(response.status).toBe(200);
  // `port`, not `PORT`: the transform is what the application reads, and the
  // key the schema validated is the environment's own spelling.
  expect(await response.json()).toEqual({ serviceName: defaultServiceName, port: 3121 });
});

test("applies the schema's default when the key is absent", async () => {
  application = await createApplication({ PORT: undefined });

  expect(await (await get(application, "/")).json()).toEqual({
    serviceName: defaultServiceName,
    port: 3100,
  });
});

test("refuses a malformed value at boot and names the key it refused", async () => {
  let thrown: unknown;

  try {
    application = await createApplication({ PORT: "abc" });
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(AponiaError);
  expect((thrown as AponiaError).code).toBe("INVALID_CONFIGURATION_VALUE");
  expect(JSON.stringify((thrown as AponiaError).details)).toContain("PORT");
});

test("reads back the one value the application was built with", async () => {
  application = await createApplication({ PORT: "3123" });

  expect(application.get(AppConfig).port).toBe(3123);
  // The container caches one instance per provider, so identity is the read's
  // contract rather than an implementation detail: two reads answer one object,
  // and that object is the one the route reported above.
  expect(application.get(AppConfig)).toBe(application.get(AppConfig));
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun run --cwd examples/configuration test`
Expected: FAIL — `Cannot find module '../src/app.module.ts'`.

- [ ] **Step 4: Write the example**

`examples/configuration/src/config.ts`:

```ts
import { defineConfiguration } from "@aponiajs/common";
import { z } from "zod";

/**
 * The application's configuration, declared once.
 *
 * The keys are the environment's variable names, so `PORT` is what a `.env` file
 * defines and what a deployment sets. The transform is what gives the application
 * the name it reads — `port` — and it is also where the coercion lands: `PORT`
 * arrives as a string, so `PORT=abc` fails the boot instead of reaching `listen`
 * as `NaN`.
 */
export const AppConfig = defineConfiguration(
  z
    .object({
      PORT: z.coerce.number().int().positive().default(3100),
      SERVICE_NAME: z.string().min(1).default("aponia-example-configuration"),
    })
    .transform(({ PORT, SERVICE_NAME }) => ({ port: PORT, serviceName: SERVICE_NAME })),
  "app.config",
);
```

`examples/configuration/src/app.service.ts`:

```ts
import { Inject, Injectable } from "@aponiajs/common";
import { AppConfig } from "./config.ts";

/** Reads the validated configuration the way a service does: by injection. */
@Injectable()
export class AppService {
  constructor(
    @Inject(AppConfig)
    private readonly config: { readonly port: number; readonly serviceName: string },
  ) {}

  describe(): { readonly serviceName: string; readonly port: number } {
    return { serviceName: this.config.serviceName, port: this.config.port };
  }
}
```

`examples/configuration/src/app.controller.ts`:

```ts
import { Controller, Get } from "@aponiajs/common";
import { AppService } from "./app.service.ts";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  describe(): { readonly serviceName: string; readonly port: number } {
    return this.appService.describe();
  }
}
```

`examples/configuration/src/app.module.ts`:

```ts
import { Module } from "@aponiajs/common";
import { provideConfiguration } from "@aponiajs/platform-elysia";
import { AppController } from "./app.controller.ts";
import { AppService } from "./app.service.ts";
import { AppConfig } from "./config.ts";

@Module({
  providers: [provideConfiguration(AppConfig), AppService],
  controllers: [AppController],
  // Exported so a module that imports this one can inject the same value
  // instead of validating the environment a second time.
  exports: [AppConfig],
})
export class AppModule {}
```

`examples/configuration/src/main.ts`:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";
import { AppConfig } from "./config.ts";

export async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule);
  // The port is the validated configuration's, read back from the container the
  // boot built. A `PORT` the schema refuses fails the boot above, before this
  // line runs, so a malformed value never reaches `listen`.
  await application.listen(application.get(AppConfig).port);
}

if (import.meta.main) {
  await bootstrap();
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run --cwd examples/configuration test`
Expected: 4 pass.

- [ ] **Step 6: Register the example in the three places**

In `package.json`, after `"example:basic"`, add
`"example:configuration": "bun run --cwd examples/configuration start",`.

In `examples/README.md`, append to the table after the `lifecycle` row:

```markdown
| `configuration` | A declared configuration, validated once at boot, injected, and read back | 3100 | `bun run example:configuration` |
```

In `examples/AGENTS.md`, add `` `configuration` `` to the directory list after
`` `lifecycle` ``.

- [ ] **Step 7: Write the example's README and point the reference page at it**

`examples/configuration/README.md`:

````markdown
# Configuration

The application declares the shape of its configuration once. `src/config.ts` holds the
Standard Schema and the transform that gives the application the names it reads,
`AppModule` declares the provider that validates the process environment while the
application boots, `AppService` receives the validated value by injection, and
`src/main.ts` listens on the port it reads back through `application.get(AppConfig)`.

Nothing reads a key twice and nothing coerces a string by hand: `PORT=abc` fails the boot
with `INVALID_CONFIGURATION_VALUE` and an issue whose `path` names `PORT`, where
`Number(Bun.env.PORT ?? 3100)` would have passed `NaN` to `listen`.

## Run

```bash
bun run example:configuration
```

The port comes from `PORT`, defaulting to `3100`; `SERVICE_NAME` renames the service the
route reports.

## Test

```bash
bun run --cwd examples/configuration test
```

`test/configuration.e2e-spec.ts` boots the real module against an environment the test
chooses — saving and restoring every key it sets, because the example reads the process
environment by design. It asserts the transformed value the route reports, the schema's
default when the key is absent, the refusal of `PORT=abc` with the key named in
`details.issues`, and that `application.get(AppConfig)` answers the one object the
container cached.

In `docs/configuration.md`'s Documentation block, add above the "Published packages" line:

- [The configuration example](../examples/configuration/README.md): the declaration, the
  injected value, and the two failures as a running application.
````

- [ ] **Step 8: Run the gates for this task and commit**

```bash
bun run check --fix
bun run --cwd examples/configuration test
bun run test:examples
rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .
git add examples/configuration examples/README.md examples/AGENTS.md package.json docs/configuration.md
git commit -m "feat(examples): run the declared configuration as an application"
```

---

### Task 2: `examples/devtools`

**Files:**

- Create: `examples/devtools/package.json`
- Create: `examples/devtools/tsconfig.json`
- Create: `examples/devtools/vite.config.ts`
- Create: `examples/devtools/src/logger.ts`
- Create: `examples/devtools/src/app.service.ts`
- Create: `examples/devtools/src/app.controller.ts`
- Create: `examples/devtools/src/app.module.ts`
- Create: `examples/devtools/src/main.ts`
- Create: `examples/devtools/test/application.ts`
- Create: `examples/devtools/test/devtools.e2e-spec.ts`
- Create: `examples/devtools/README.md`
- Modify: `package.json` (the `example:*` scripts)
- Modify: `examples/README.md` (the table)
- Modify: `examples/AGENTS.md` (the directory list)
- Modify: `docs/devtools.md:607-615` (the Documentation block)

**Interfaces:**

- Consumes: `devtoolsPlugin` and `devtoolsPathPrefix` from `@aponiajs/devtools`;
  `AponiaFactory` from `@aponiajs/platform-elysia`; `Logger` from `@aponiajs/common`.
- Produces: `createApplication(options?)` returning
  `{ application, devtools, logs }`, where `devtools` is the base URL of the mounted
  surface and `logs` is the recording logger's lines.

- [ ] **Step 1: Create the package manifest, tsconfig, and formatter config**

`examples/devtools/package.json`:

```json
{
  "name": "@aponiajs/example-devtools",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/main.ts",
    "build": "bun build ./src/main.ts --outdir ./dist --target bun",
    "test": "bun test ../../examples/devtools/test/*.e2e-spec.ts",
    "check": "vp check"
  },
  "dependencies": {
    "@aponiajs/common": "workspace:*",
    "@aponiajs/core": "workspace:*",
    "@aponiajs/devtools": "workspace:*",
    "@aponiajs/platform-elysia": "workspace:*",
    "elysia": "^1.4.30"
  }
}
```

`examples/devtools/tsconfig.json` — Task 1's file with one more mapping:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "lib": ["ESNext"],
    "moduleDetection": "force",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "types": ["bun"],
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "noUnusedLocals": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "paths": {
      "@aponiajs/common": ["../../packages/common/src/index.ts"],
      "@aponiajs/core": ["../../packages/core/src/index.ts"],
      "@aponiajs/devtools": ["../../packages/devtools/src/index.ts"],
      "@aponiajs/platform-elysia": ["../../packages/platform-elysia/src/index.ts"]
    }
  }
}
```

`examples/devtools/vite.config.ts` is Task 1's file, unchanged.

- [ ] **Step 2: Write the failing test**

`examples/devtools/test/application.ts`:

```ts
import { createServer } from "node:net";
import type { LoggerService } from "@aponiajs/common";
import { devtoolsPathPrefix, devtoolsPlugin } from "@aponiajs/devtools";
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

/**
 * A logger that records what it is given and writes nothing.
 *
 * The plugin patches the logger it is handed so `/__devtools/logs` can serve
 * those lines, and the factory writes its own bootstrap lines through the logger
 * it is handed. One object reaches both, which is the example's point, so the
 * case that asserts `/logs` is asserting on a line the boot really wrote.
 */
export interface RecordingLogger extends LoggerService {
  readonly lines: readonly string[];
}

function createRecordingLogger(): RecordingLogger {
  const lines: string[] = [];

  return {
    lines,
    log: (message: unknown) => lines.push(String(message)),
    fatal: (message: unknown) => lines.push(String(message)),
    error: (message: unknown) => lines.push(String(message)),
    warn: (message: unknown) => lines.push(String(message)),
  };
}

/** Binds the loopback socket on port `0` and reads the address it took. */
async function reservePort(): Promise<number> {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });

  const address = reservation.address();
  if (!address || typeof address === "string") {
    reservation.close();
    throw new Error("Could not reserve an ephemeral test port.");
  }

  const port = address.port;
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

export interface DevtoolsApplication {
  readonly application: AponiaElysiaApplication;
  /** The mounted surface's base URL, prefix included. */
  readonly devtools: string;
  readonly logger: RecordingLogger;
}

export async function createApplication(enabled = true): Promise<DevtoolsApplication> {
  const applicationPort = await reservePort();
  const devtoolsPort = await reservePort();
  const logger = createRecordingLogger();

  const application = await AponiaFactory.create(AppModule, {
    logger,
    plugins: [devtoolsPlugin({ enabled, port: devtoolsPort, logger })],
  });
  await application.listen(applicationPort);

  return {
    application,
    devtools: `http://127.0.0.1:${devtoolsPort}${devtoolsPathPrefix}`,
    logger,
  };
}

export function get(application: AponiaElysiaApplication, path: string): Promise<Response> {
  return Promise.resolve(application.handle(new Request(`http://localhost${path}`)));
}

export function read<T>(url: string): Promise<T> {
  return fetch(url).then((response) => response.json() as Promise<T>);
}
```

`examples/devtools/test/devtools.e2e-spec.ts`:

```ts
import { afterEach, expect, test } from "bun:test";
import type { DevtoolsApplication } from "./application.ts";
import { createApplication, get, read } from "./application.ts";

let booted: DevtoolsApplication | undefined;

afterEach(async () => {
  await booted?.application.close();
  booted = undefined;
});

test("meta reports the contract and the versions the boot ran", async () => {
  booted = await createApplication();

  const meta = await read<{ contract: number; framework: string; elysia: string | null }>(
    `${booted.devtools}/meta`,
  );

  expect(meta.contract).toBe(2);
  expect(meta.framework).toStartWith("0.");
  expect(meta.elysia).toStartWith("1.");
});

test("graph reports the module the boot compiled", async () => {
  booted = await createApplication();

  const graph = await read<{
    rootModule: string;
    modules: readonly { id: string; controllers: readonly string[] }[];
  }>(`${booted.devtools}/graph`);

  expect(graph.rootModule).toBe("AppModule");
  expect(graph.modules.flatMap((module) => module.controllers)).toContain("AppController");
});

test("routes reports each mounted route and the binding that serves it", async () => {
  booted = await createApplication();

  const routes = await read<{
    routes: readonly { method: string; path: string; controller: string; source: string }[];
  }>(`${booted.devtools}/routes`);

  expect(routes.routes).toContainEqual(
    expect.objectContaining({
      method: "GET",
      path: "/greetings",
      controller: "AppController",
      source: "compiled",
    }),
  );
});

test("flow reports the stages a route passes through", async () => {
  booted = await createApplication();

  const flow = await read<{ routes: readonly { id: string; stages: readonly { id: string }[] }[] }>(
    `${booted.devtools}/flow`,
  );

  // The id is the route key both `/flow` and `/routes` build: `METHOD path`.
  const route = flow.routes.find((entry) => entry.id === "GET /greetings");
  expect(route).toBeDefined();
  expect(route!.stages.length).toBeGreaterThan(0);
});

test("requests records a request the application answered", async () => {
  booted = await createApplication();

  const response = await get(booted.application, "/greetings");
  expect(response.status).toBe(200);

  const requests = await read<{
    entries: readonly { id: number; method: string; path: string; status: number | null }[];
  }>(`${booted.devtools}/requests`);

  // One request writes two entries under one id — one when it arrived and one
  // when it was answered — so the answer is the last entry carrying that id.
  const last = requests.entries.at(-1);
  expect(last).toMatchObject({ method: "GET", path: "/greetings", status: 200 });
});

test("logs serves the lines the one logger both places were handed wrote", async () => {
  booted = await createApplication();

  const logs = await read<{
    entries: readonly { level: string; context: string; message: string }[];
  }>(`${booted.devtools}/logs`);

  expect(logs.entries).toContainEqual(
    expect.objectContaining({
      context: "AponiaApplication",
      message: "Aponia application successfully started",
    }),
  );
  // The same object reached the plugin: what the factory wrote is what the
  // endpoint serves. A second logger would leave this list empty.
  expect(booted.logger.lines).toContain("Aponia application successfully started");
});

test("aot answers the boot's own record when no build wrote an analysis", async () => {
  booted = await createApplication();

  const aot = await read<{
    graph: string;
    invokers: { accepted: boolean; reason?: string };
  }>(`${booted.devtools}/aot`);

  expect(aot.graph).toBe("decorated");
  expect(aot.invokers.accepted).toBe(false);
  expect(aot.invokers.reason).toBeTruthy();
});

test("a disabled registration mounts nothing at all", async () => {
  booted = await createApplication(false);

  expect(await fetch(`${booted.devtools}/meta`).catch(() => "refused")).toBe("refused");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun run --cwd examples/devtools test`
Expected: FAIL — `Cannot find module '../src/app.module.ts'`.

- [ ] **Step 4: Write the example**

`examples/devtools/src/logger.ts`:

```ts
import { Logger } from "@aponiajs/common";

/**
 * The application's logger, held here because two places take the same object.
 *
 * `AponiaFactory.create` writes every bootstrap line through the logger it is
 * handed, and `devtoolsPlugin` patches the logger it is handed in place so
 * `/__devtools/logs` can serve those lines. Hand it to both or to neither: a
 * logger that reached only one of them leaves the other with nothing to record
 * or nothing to record from.
 */
export const appLogger = new Logger("Example");
```

`examples/devtools/src/app.service.ts`:

```ts
import { Injectable } from "@aponiajs/common";

/** A service with state, so `/flow` and `/requests` have something to report. */
@Injectable()
export class AppService {
  #served = 0;

  greet(): { readonly greeting: string; readonly served: number } {
    this.#served += 1;
    return { greeting: "Hello, AponiaJS!", served: this.#served };
  }
}
```

`examples/devtools/src/app.controller.ts`:

```ts
import { Controller, Get } from "@aponiajs/common";
import { AppService } from "./app.service.ts";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get("/greetings")
  greet(): { readonly greeting: string; readonly served: number } {
    return this.appService.greet();
  }

  @Get()
  health(): { readonly ok: boolean } {
    return { ok: true };
  }
}
```

`examples/devtools/src/app.module.ts`:

```ts
import { Module } from "@aponiajs/common";
import { AppController } from "./app.controller.ts";
import { AppService } from "./app.service.ts";

@Module({
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

`examples/devtools/src/main.ts`:

```ts
import { devtoolsPlugin } from "@aponiajs/devtools";
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";
import { appLogger } from "./logger.ts";

export async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule, {
    logger: appLogger,
    // The one object reaches both, which is what makes `/__devtools/logs` carry
    // the boot's own lines. The surface binds loopback and reports rather than
    // silences a `host` that widens it.
    plugins: [
      devtoolsPlugin({
        enabled: Bun.env.ENABLE_DEVTOOLS !== "false",
        port: Number(Bun.env.DEVTOOLS_PORT ?? 3111),
        logger: appLogger,
      }),
    ],
  });

  await application.listen(Number(Bun.env.PORT ?? 3110));
}

if (import.meta.main) {
  await bootstrap();
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun run --cwd examples/devtools test`
Expected: 8 pass. If a case fails, the payload is the authority rather than this plan:
`packages/devtools/src/endpoints/payloads.types.ts` declares every field `/meta`,
`/graph`, `/routes`, `/logs`, `/requests`, and `/aot` answer with, and
`packages/devtools/src/endpoints/flow.types.ts` declares `/flow`'s. Read the declaration,
correct the assertion to it, and say in the report which field moved.

- [ ] **Step 6: Register the example in the three places**

In `package.json`, after `"example:descriptors"`, add
`"example:devtools": "bun run --cwd examples/devtools start",`.

In `examples/README.md`, append to the table after the `configuration` row:

```markdown
| `devtools` | What a boot compiled and what each request answered, served on loopback | 3110 | `bun run example:devtools` |
```

In `examples/AGENTS.md`, add `` `devtools` `` to the directory list after
`` `configuration` ``.

- [ ] **Step 7: Write the example's README and point the reference page at it**

`examples/devtools/README.md`:

````markdown
# Devtools

The opt-in surface that reports what a running application actually is. `src/main.ts`
mounts `devtoolsPlugin` through the factory's `plugins` option and hands it the same
logger object the factory gets, which is what makes `/__devtools/logs` carry the boot's
own lines.

## Run

```bash
bun run example:devtools
```

The application listens on `PORT`, defaulting to `3110`. The surface binds
`127.0.0.1:3111` unless `DEVTOOLS_PORT` names another port, and `ENABLE_DEVTOOLS=false`
mounts nothing at all — no provider, no plugin, no socket.

| Endpoint               | Answers                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/__devtools/meta`     | The contract version, this framework's release, the Elysia it ran, and which artifacts the boot adopted                                                                    |
| `/__devtools/graph`    | The module graph the boot compiled                                                                                                                                         |
| `/__devtools/routes`   | Every mounted route with the binding that serves it                                                                                                                        |
| `/__devtools/flow`     | The stages each route passes through, in order                                                                                                                             |
| `/__devtools/logs`     | The application's log stream, through the one logger both places were handed                                                                                               |
| `/__devtools/requests` | What each request was and what answered it                                                                                                                                 |
| `/__devtools/aot`      | What a build decided about this project's invokers — the boot's own record alone when no build wrote an analysis, which is this example's case and says so in its `reason` |

## Test

```bash
bun run --cwd examples/devtools test
```

`test/devtools.e2e-spec.ts` boots the real module with the surface mounted, reserving both
ports from the operating system so the lane never binds a fixed one, and reads each
endpoint over HTTP. It asserts the contract and the versions, the compiled graph, the
route table's binding, the stages of one route, a request the application answered with
its status, the boot's own line in `/logs`, the degraded half of `/aot`, and that a
disabled registration serves nothing.

In `docs/devtools.md`'s Documentation block, add above the "Published packages" line:

- [The devtools example](../examples/devtools/README.md): the surface mounted on a running
  application, one endpoint at a time.
````

- [ ] **Step 8: Run the gates for this task and commit**

```bash
bun run check --fix
bun run --cwd examples/devtools test
bun run test:examples
rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .
git add examples/devtools examples/README.md examples/AGENTS.md package.json docs/devtools.md
git commit -m "feat(examples): serve the devtools surface from a running application"
```

---

### Task 3: The claim the set now makes, and the release

**Files:**

- Modify: `docs/learn/01-overview.md:55-57` (only if the check below fails)

**Interfaces:**

- Consumes: both example directories and their registrations.
- Produces: the verified branch, bumped and pushed with a pull request.

- [ ] **Step 1: Check the learning path's claim rather than assuming it**

`docs/learn/01-overview.md:55-57` says most chapters have a runnable counterpart and
names the four that do not: errors, testing, releasing, and enhancers. Chapter 14
devtools was outside that list and had no example; it has one now. Confirm the sentence
is true as it stands:

```bash
rg -n "no example of their own" docs/learn/01-overview.md
```

Expected: the four names, and devtools not among them. If the sentence still names a
chapter that now has an example, or a chapter with one that is not named, edit the
sentence to match the tree — that is the only edit this task may make to it.

- [ ] **Step 2: Run the whole-branch verification**

```bash
bun run check
bun test scripts/
bun run test:examples
bun run test:coverage
bun run test:vite-plus
bun run release:dry-run
bun run build
find packages -name '*.d.ts' -path '*/src/*' -delete
bun run test:generated-app
rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .
```

`bun run build` builds the examples as well as the packages, so a broken example fails
here even though no package changed. `test:examples` is the lane that runs both new
suites the way CI does.

- [ ] **Step 3: Bump the synchronized version**

```bash
bun run version:alpha
bun test scripts/documentation-versions.spec.ts
```

The bump moves the root manifest, the publishable packages, and the lockfile together.
`version:sync` rewrites the lockfile only, so the published stamps that name this release
move by hand and that guard is what says so.

- [ ] **Step 4: Push and open the pull request**

`bun run version:alpha` moves `0.6.0-alpha.30` to `0.6.0-alpha.31` and the tag stays
`alpha`. Commit it, then push and open the pull request:

```bash
git add -A
git commit -m "chore(release): bump every manifest to 0.6.0-alpha.31"
git push -u origin feature/example-applications
gh pr create --base release/alpha \
  --title "docs(examples): run the two shipped topics that had no example" \
  --body-file .tmp/pr-body.md
```

Write `.tmp/pr-body.md` before the last command with the four sections `AGENTS.md`
requires of a pull request here: the intent (two topics shipped without an example, and
the convention that owes one), the affected areas (the two example directories and the
four registers — the root manifest, `examples/README.md`, `examples/AGENTS.md`, and the
two reference pages), the validation results copied from Step 2's output rather than
restated, and the note that no `packages/**` file changed. End it with
`🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Whole-branch verification

Task 3 Step 2 is the list. Two entries deserve their own sentence: `bun run build`
builds the examples, which is how a stale example reaches CI, and `bun run test:examples`
is the only lane that runs both new suites end to end.

## What this plan does not do

- **No framework change.** No file under `packages/**` is touched, so no contract, no
  conformance case, and no coverage floor moves.
- **No learn chapter and no new cross-link convention.** No chapter mentions an example
  today; adding links from two of them would invent a convention, and the one sentence
  that does make a claim about the set is checked against the tree instead.
- **No `aponia.json`, no `scripts/`, no generated artifacts** in either example: they
  are applications to read and run rather than starters the generator produced, and the
  devtools example's `/aot` case asserts the degraded answer that follows.
- **No example for enhancers, logging, errors, testing, or releasing.** The first two
  are covered by existing examples' rows, and the last three are named by
  `docs/learn/01-overview.md` as having no example of their own.

## Follow-up work this plan found and did not take

Asked mid-run why `@aponiajs/cli`'s generator was not used to create these examples. It was not
used, and the question exposed a real gap — so the answer is measured rather than argued.

`bun packages/cli/bin/aponia.ts new probe-app --skip-install` writes **21 files**. Each example
needs **11**. Of the 21, **twelve must be deleted** (`.env.example`, `.gitignore`, `AGENTS.md`,
`aponia.json`, `llms.txt`, `scripts/build.ts`, `scripts/inspect.ts`, `src/app.controller.spec.ts`,
`src/config.ts`, `src/descriptors.generated.ts`, `src/invokers.generated.ts`,
`test/app.e2e-spec.ts`); **two of the nine overlapping files must be rewritten**, because the
generated `package.json` pins the published versions where an example needs `workspace:*` and the
generated `tsconfig.json` carries no `paths` at all where every example maps `@aponiajs/*` at
`../../packages/*/src`; and **one is byte-identical** (`vite.config.ts`).

Those twelve deletions are not a preference. `aponia.json`, `scripts/`, and the two
`*.generated.ts` artifacts are what make the generator's output a **starter that builds**, and this
plan settles that an example is an application to read and run — which is what all ten examples
that came before these two are.

**The gap:** `package.json`, `tsconfig.json`, and `vite.config.ts` are hand-copied once per
example, so the twelfth example makes thirty-six near-duplicate configuration files, and the
generator cannot help because it only knows the standalone-app shape. The instruction was to keep
this plan's hand-written path and record the gap, so the fix is left to its own change and it has
two shapes: an `example` schematic in `@aponiajs/cli` that emits the example form, or a shared base
configuration the examples extend. Either one belongs with `packages/cli`, which this plan does not
touch.
