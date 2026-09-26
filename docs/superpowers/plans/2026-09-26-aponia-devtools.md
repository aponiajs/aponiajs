# Aponia DevTools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@aponiajs/devtools` — an opt-in runtime plugin that serves a read-only HTTP API on a forced loopback address, so a consumer can build its own UI against a versioned payload contract.

**Architecture:** Two platform changes land first, each independently shippable: `inspectAponiaApplication` learns to resolve artifacts, and bootstrap exposes the boot decision plus the compiled graph through an `@internal` seam. The package follows: an `ElysiaPluginModule` whose plugin starts a `Bun.serve` on `127.0.0.1` at `onStart`, serving seven `GET` endpoints under `/__devtools`.

**Tech Stack:** Bun (`Bun.serve`), TypeScript (strict, ESM, explicit `.ts` extensions), Elysia 1.4.x, `@aponiajs/platform-elysia`, `@aponiajs/common`, and — lazily, for one endpoint — `@aponiajs/cli`.

**Spec:** `docs/superpowers/specs/2026-09-26-aponia-devtools-design.md`

## Global Constraints

- All repository content is English. Before finishing, scan:
  `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`
- The bind address is **not configurable**: `127.0.0.1` always. There is no `host` option.
- `enabled` is required and is the application's decision. The framework never reads an environment variable on the application's behalf.
- Requests are captured by default, with their headers and body. Every `capture` option is an opt-out, not a permission: this is a development tool, and it shows a developer everything until the developer says otherwise.
- Every endpoint is a `GET`. Any other method answers `405`; an unknown path answers `404`.
- Every response is frozen, JSON-serializable, and deterministically ordered.
- A debugging aid must never fail a boot: a bound port logs under `Devtools` and the application continues.
- No UI, no assets, no bundler step. No playground. No mutation endpoint.
- `routing/native-route.ts` remains the only module in `platform-elysia` that calls Elysia's route registration API. This package never touches it.
- A package's own tests import its API from `../src/index.ts`; other packages are imported by name.
- Return frozen data. Type-only imports under `import type`. `#private` class fields, not `private`. Explicit `.ts` extensions, two-space indentation, ESM, no `any`.
- Every runtime TypeScript source under `packages/*/src/**/*.ts` must appear in LCOV; aggregate line and function coverage stays at or above 95%.
- Elysia's route-local error hook key is `error`; `onError` is silently ignored. This package registers no error hooks.
- Run `bun run check`, `bun run test:coverage`, and `bun run test:vite-plus` before submitting.

## Review Focus

Inputs and conditions the spec implies but whose handling no single task's tests pin. Each line names the behaviour a reasonable person expects, and the task that owns its test is named beside it.

1. **The devtools port is already bound.** The application must boot normally and log the failure under `Devtools` — a debugging aid never fails a boot. Owned by Task 4.
2. **An application that only calls `handle()` and never `listen()`s.** `onStart` does not fire, so nothing is published, and the application must be unaffected. Owned by Task 3.
3. **A request for a path under `/__devtools` that no endpoint serves, and one outside the prefix entirely.** Both answer `404` rather than crashing the server or falling through to the application. Owned by Task 4.
4. **`since` beyond the retained window.** The log endpoint returns what is retained rather than an error, and the cursor it returns is usable. Owned by Task 8.
5. **`@aponiajs/cli` fails to import** — absent, slow, or throwing. `/aot` must still serve the framework facts it has, degrading one field group rather than the endpoint. Owned by Task 10.

---

### Task 1: `inspectAponiaApplication` resolves artifacts

The spec calls this a defect independent of this package: `bun run inspect` in a generated application reports a graph the application is not running, silently.

**Files:**

- Modify: `packages/platform-elysia/src/inspection/application-inspection.ts`
- Modify: `packages/platform-elysia/src/inspection/application-inspection.types.ts` (a new options type)
- Modify: `packages/platform-elysia/src/index.ts` (export the options type)
- Test: `packages/platform-elysia/tests/inspection.test.ts`

**Interfaces:**

- Consumes: `selectRootModuleDescriptor` (internal), `AponiaApplicationOptions` from `../application/application.types.ts`.
- Produces: `inspectAponiaApplication(rootModule, options?)` where `options` is `AponiaInspectionOptions` = `Readonly<Pick<AponiaApplicationOptions, "invokers" | "descriptors">>`, plus a `logger` passthrough so a refusal reports the same line bootstrap reports.

- [ ] **Step 1: Write the failing test**

```ts
test("inspection describes the graph the application compiles when a descriptor artifact is supplied", async () => {
  // The fixture builds a module whose declared root name is absent from the artifact,
  // so the artifact is refused and the DECORATED graph must be reported.
  const inspection = inspectAponiaApplication(AppModule, {
    descriptors: Object.freeze({
      framework: aponiaVersion,
      elysia: null,
      modules: Object.freeze({}),
    }),
  });

  expect(inspection.rootModule).toBe("AppModule");
});
```

Add a second case whose artifact holds a declaration for the root name and asserts the inspection reports the declared id, so both branches are pinned.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/platform-elysia/tests/inspection.test.ts`
Expected: FAIL — `inspectAponiaApplication` accepts one argument.

- [ ] **Step 3: Accept the options and resolve the root**

In `application-inspection.ts`, add a second parameter and resolve through the same selector bootstrap uses:

```ts
export function inspectAponiaApplication(
  rootModule: AponiaRootModule,
  options: AponiaInspectionOptions = {},
): AponiaApplicationInspection {
  const resolved = selectRootModuleDescriptor(
    options.descriptors,
    rootModule,
    aponiaVersion,
    options.logger,
  );
  const container = createContainer(compileRootModule(resolved));
  // ...unchanged from here
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test packages/platform-elysia/tests/inspection.test.ts`
Expected: PASS, both new cases and every pre-existing case.

- [ ] **Step 5: Commit**

```bash
git add packages/platform-elysia/src/inspection packages/platform-elysia/src/index.ts packages/platform-elysia/tests/inspection.test.ts
git commit -m "fix(platform-elysia): resolve artifacts when inspecting an application"
```

---

### Task 2: Expose the boot decision and the compiled graph

**Files:**

- Create: `packages/platform-elysia/src/application/application-diagnostics.ts`
- Create: `packages/platform-elysia/src/application/application-diagnostics.types.ts`
- Modify: `packages/platform-elysia/src/application/application-bootstrap.ts`
- Modify: `packages/platform-elysia/src/index.ts`
- Test: `packages/platform-elysia/tests/application-diagnostics.test.ts`

**Interfaces:**

- Consumes: the local values `generatedInvokers`, `compiledRootModule`, `globalEnhancers` in `bootstrapAponiaApplication`, and each controller's `compiledRoutes`.
- Produces: `readApplicationDiagnostics(application: Elysia): AponiaApplicationDiagnostics | undefined` — an `@internal` export reading a symbol-keyed property the bootstrap attaches.
  `AponiaApplicationDiagnostics` = `{ framework: string; graph: "declared" | "decorated"; invokers: { accepted: boolean; reason: string | undefined }; rootModule: ModuleDefinition; routes: readonly AponiaCompiledRouteDiagnostics[]; globalEnhancers: EnhancerMetadata }`.
  `AponiaCompiledRouteDiagnostics` = `{ module: string; controller: string; route: CompiledElysiaRoute }`.

- [ ] **Step 1: Verify what the compiled plan already carries, before writing any code**

Run: `rg -n "schema" packages/platform-elysia/src/routing/route-compiler.types.ts`

The spec says the plans "must retain the name of the `@Validation()` model each slot resolved to". `CompiledElysiaRoute.schema` is typed `RouteSchema | undefined`, and a `RouteSchema` slot is `RouteValidatorInput` — which is `RouteValidator | ValidationModelClass`. **That means the model class may already be reachable from the plan**, and no platform change is needed to retain it.

Report which it is: if a `@Validation()` model is reachable from `route.schema[slot]`, say so and do not add a field; if the schema is already lowered by the time it reaches the plan, the name must be retained and that becomes part of this task. Do not guess — read `compileElysiaRoutes` and `toRouteHook` and state what you found.

- [ ] **Step 2: Write the failing test**

```ts
test("a booted application exposes its boot decision and compiled routes", async () => {
  const application = await AponiaFactory.create(AppModule, { logger: false });
  const diagnostics = readApplicationDiagnostics(application.getNativeApplication());

  expect(diagnostics?.graph).toBe("decorated");
  expect(diagnostics?.framework).toBe(aponiaVersion);
  expect(diagnostics?.routes.map((entry) => entry.route.path)).toContain("/");
  await application.close();
});

test("an application that was never booted through the factory exposes nothing", () => {
  expect(readApplicationDiagnostics(new Elysia())).toBeUndefined();
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test packages/platform-elysia/tests/application-diagnostics.test.ts`
Expected: FAIL — `readApplicationDiagnostics` is not exported.

- [ ] **Step 4: Attach and read**

```ts
// application-diagnostics.ts
const diagnosticsKey = Symbol.for("aponia.application.diagnostics");

/** @internal */
export function attachApplicationDiagnostics(
  application: Elysia,
  diagnostics: AponiaApplicationDiagnostics,
): void {
  Object.defineProperty(application, diagnosticsKey, {
    value: Object.freeze(diagnostics),
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

/** @internal */
export function readApplicationDiagnostics(
  application: Elysia,
): AponiaApplicationDiagnostics | undefined {
  return (application as { readonly [diagnosticsKey]?: AponiaApplicationDiagnostics })[
    diagnosticsKey
  ];
}
```

Call `attachApplicationDiagnostics` in `bootstrapAponiaApplication` after the resolutions and after the controllers have mounted, collecting each controller's `compiledRoutes` from the container. The `graph` value is `"decorated"` when the resolved root is the module the caller passed and `"declared"` when it is not — derive it from what `selectRootModuleDescriptor` returned, not from re-reading the artifact.

- [ ] **Step 5: Run it to verify it passes**

Run: `bun test packages/platform-elysia/tests/application-diagnostics.test.ts`
Expected: PASS.

- [ ] **Step 6: Pin that the seam is not public surface**

Add a case asserting `readApplicationDiagnostics(new Elysia())` is `undefined`, and confirm the symbol property does not appear in `Object.keys(application)` — the seam must not become enumerable state other code walks.

- [ ] **Step 7: Commit**

```bash
git add packages/platform-elysia/src/application packages/platform-elysia/src/index.ts packages/platform-elysia/tests/application-diagnostics.test.ts
git commit -m "feat(platform-elysia): expose the boot decision and the compiled graph"
```

---

### Task 3: The package, the module, and the enable switch

**Files:**

- Create: `packages/devtools/package.json`, `packages/devtools/tsconfig.json`, `packages/devtools/tsconfig.build.json`, `packages/devtools/AGENTS.md`, `packages/devtools/README.md`
- Create: `packages/devtools/src/index.ts`
- Create: `packages/devtools/src/module/devtools-module.ts`, `packages/devtools/src/module/devtools-module.types.ts`
- Modify: `scripts/source-layout.spec.ts` (add the package's domain directories)
- Modify: root `AGENTS.md` (index the new package guide)
- Test: `packages/devtools/tests/devtools-module.test.ts`

**Interfaces:**

- Consumes: `ElysiaPluginModule.register` from `@aponiajs/platform-elysia`.
- Produces: `DevtoolsModule.register(options: DevtoolsOptions): DynamicModule`, where `DevtoolsOptions` = `{ readonly enabled: boolean; readonly port?: number }`.

Copy `packages/aponiajs/package.json` for the manifest shape and `packages/platform-elysia/tsconfig.json` for the compiler options — every package declares `experimentalDecorators` and `emitDecoratorMetadata`, and `scripts/toolchain-config.spec.ts` holds that. The manifest's `version` is the workspace version the root manifest carries at that moment; `bun run release:verify` fails when the package set and the version references disagree, so run it in Step 6 and let it tell you what else has to move.

- [ ] **Step 1: Write the failing test**

```ts
test("a disabled module mounts no plugin and opens no socket", async () => {
  const application = await AponiaFactory.create(DisabledModule, { logger: false });

  await expect(fetch("http://127.0.0.1:8123/__devtools/meta")).rejects.toThrow();
  await application.close();
});

test("an enabled module answers on the loopback address", async () => {
  const application = await AponiaFactory.create(EnabledModule, { logger: false });
  await application.listen(0);

  const response = await fetch("http://127.0.0.1:8123/__devtools/meta");
  expect(response.status).toBe(200);
  await application.close();
});
```

Use a port unlikely to be taken and assert the disabled case by the connection failing, not by a timeout.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test packages/devtools/tests/devtools-module.test.ts`
Expected: FAIL — the package does not exist.

- [ ] **Step 3: Create the package and the module**

`DevtoolsModule.register` returns a disabled, inert module when `enabled` is `false` — `{ module: DevtoolsModule, providers: [], imports: [] }`, with no plugin registered. When `true` it returns `ElysiaPluginModule.register(devtoolsPlugin(options), { key: "devtools" })`.

The plugin itself is an `Elysia` instance carrying an `onStart` hook; Task 4 gives it the server. In this task it logs one line under `Devtools` at `onStart` so the enable switch is observable before the server exists.

- [ ] **Step 4: Run it to verify it passes**

Run: `bun test packages/devtools/tests/devtools-module.test.ts`
Expected: PASS, both cases.

- [ ] **Step 5: Pin that a `handle()`-only application is unaffected**

Add a case booting an enabled module, calling `application.handle(new Request("http://localhost/"))` without `listen()`, and asserting the application answers normally and no socket was opened. `onStart` does not fire without `listen()`, so nothing publishes — the application must be indifferent to that.

- [ ] **Step 6: Run the package's lanes and the layout guard**

Run: `bun run --filter @aponiajs/devtools test && bun test scripts/source-layout.spec.ts scripts/agent-guides.spec.ts`
Expected: PASS. The layout guard fails until the package's domain directories are listed and the guide exists.

- [ ] **Step 7: Commit**

```bash
git add packages/devtools scripts/source-layout.spec.ts AGENTS.md
git commit -m "feat(devtools): add the package and its opt-in module"
```

---

### Task 4: The server, and `/__devtools/meta`

**Files:**

- Create: `packages/devtools/src/server/devtools-server.ts`, `packages/devtools/src/server/devtools-server.types.ts`
- Create: `packages/devtools/src/server/request-router.ts`
- Create: `packages/devtools/src/endpoints/meta.ts`
- Create: `packages/devtools/src/endpoints/payloads.types.ts`
- Test: `packages/devtools/tests/server.test.ts`

**Interfaces:**

- Consumes: `readApplicationDiagnostics` from `@aponiajs/platform-elysia` (Task 2), `DevtoolsOptions` (Task 3).
- Produces: `startDevtoolsServer(options): DevtoolsServer` where `DevtoolsServer` = `{ readonly url: string; stop(): void }`; `routeRequest(request, handlers): Response` — the pure dispatcher, which is what makes 404/405 testable without a socket.

- [ ] **Step 1: Write the failing test**

```ts
test("a non-GET method answers 405 and an unknown path answers 404", async () => {
  const get = await fetch(`${url}/__devtools/meta`);
  expect(get.status).toBe(200);

  const post = await fetch(`${url}/__devtools/meta`, { method: "POST" });
  expect(post.status).toBe(405);

  const unknown = await fetch(`${url}/__devtools/nope`);
  expect(unknown.status).toBe(404);

  const outside = await fetch(`${url}/not-devtools`);
  expect(outside.status).toBe(404);
});
```

- [ ] **Step 2: Write the `/meta` assertion**

```ts
test("meta carries the contract version and the release it speaks", async () => {
  const payload = await (await fetch(`${url}/__devtools/meta`)).json();

  expect(payload.contract).toBe(1);
  expect(payload.framework).toBe(aponiaVersion);
  expect(typeof payload.startedAt).toBe("string");
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test packages/devtools/tests/server.test.ts`
Expected: FAIL — no server exists.

- [ ] **Step 4: Implement the server and the dispatcher**

`Bun.serve({ hostname: "127.0.0.1", port, fetch: handler })`. The hostname is a literal, not read from options. `startDevtoolsServer` catches a bind failure, logs it under `Devtools`, and returns `undefined` so the plugin can continue — the boot must survive a taken port.

`routeRequest` takes the `Request` and a record of `GET` handlers keyed by the path suffix after `/__devtools`, and returns a `Response`. A method other than `GET` returns `405` before any path lookup; an unknown suffix or a path outside the prefix returns `404`.

- [ ] **Step 5: Run it to verify it passes**

Run: `bun test packages/devtools/tests/server.test.ts`
Expected: PASS.

- [ ] **Step 6: Pin the boot survives a taken port**

Bind a `Bun.serve` on the port the test will use, boot an application whose devtools points at it, and assert the application still answers its own routes and that one `Devtools`-contexted line was logged. This is Review Focus item 1.

- [ ] **Step 7: Commit**

```bash
git add packages/devtools/src/server packages/devtools/src/endpoints
git commit -m "feat(devtools): serve the loopback API and report the contract version"
```

---

### Task 5: `/__devtools/graph`

**Files:**

- Create: `packages/devtools/src/endpoints/graph.ts`
- Modify: `packages/devtools/src/endpoints/payloads.types.ts` (add this endpoint's payload type)
- Test: `packages/devtools/tests/graph.test.ts`

**Interfaces:**

- Consumes: `AponiaApplicationDiagnostics.rootModule` (Task 2), `compileRootModule` and the inspection types from `@aponiajs/platform-elysia`.
- Produces: `buildGraphPayload(diagnostics): AponiaGraphPayload` — the inspection shape **minus `routes`**.

- [ ] **Step 1: Write the failing test**

```ts
test("graph reports the compiled root and carries no routes key", async () => {
  const payload = await (await fetch(`${url}/__devtools/graph`)).json();

  expect(payload.rootModule).toBe("AppModule");
  expect(Object.hasOwn(payload, "routes")).toBe(false);
  expect(payload.modules.map((module: { id: string }) => module.id)).toContain("AppModule");
});
```

- [ ] **Step 2: Write the branch case**

```ts
test("graph describes the decorated root when the descriptor artifact is refused", async () => {
  // Boot with a descriptors artifact that holds no declaration for the root name.
  const payload = await (await fetch(`${url}/__devtools/graph`)).json();

  expect(payload.rootModule).toBe("AppModule");
});
```

and a companion case supplying an artifact that **does** declare the root, asserting the id the declaration carries. Both branches must be pinned; only one of them is reachable per boot.

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test packages/devtools/tests/graph.test.ts`
Expected: FAIL — the endpoint answers `404`.

- [ ] **Step 4: Implement it**

Read the diagnostics' `rootModule`, lower it through `compileRootModule`, and project it with the same function inspection uses, dropping `routes`. Do not re-derive the graph from the decorated classes — that is the defect Task 1 fixed.

- [ ] **Step 5: Run it to verify it passes**

Run: `bun test packages/devtools/tests/graph.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/devtools/src/endpoints/graph.ts packages/devtools/tests/graph.test.ts
git commit -m "feat(devtools): report the compiled module graph"
```

---

### Task 6: `/__devtools/routes`

**Files:**

- Create: `packages/devtools/src/endpoints/routes.ts`
- Modify: `packages/devtools/src/endpoints/payloads.types.ts` (add this endpoint's payload type)
- Test: `packages/devtools/tests/routes.test.ts`

**Interfaces:**

- Consumes: the running native application (read at request time, not at boot), `readApplicationDiagnostics` for the compiled plans.
- Produces: `buildRoutesPayload(application, diagnostics): AponiaRoutesPayload`.

- [ ] **Step 1: Write the failing test**

```ts
test("routes reports every mounted route with the invoker that serves it", async () => {
  const payload = await (await fetch(`${url}/__devtools/routes`)).json();
  const paths = payload.routes.map((route: { path: string }) => route.path);

  expect(paths).toContain("/");
  expect(
    payload.routes.every(
      (route: { source: string }) => route.source === "generated" || route.source === "compiled",
    ),
  ).toBe(true);
});
```

- [ ] **Step 2: Write the two-source case**

Boot a controller served by a generated invoker and one the runtime compiles, in one application, and assert `source` reads `"generated"` for the first and `"compiled"` for the second. A case that only ever sees one of the two does not pin the field.

- [ ] **Step 3: Write the callback case**

Register a controller through `elysiaController` and assert its route appears with its path and method. Its handler name cannot be recovered — the mounted application knows the path and method but not the class property that built it. Pin exactly what the spec's accepted-limitation claims: the route appears with its method and path, `controller` is the registered controller's name, and `handler` is the empty string rather than a guess.

- [ ] **Step 4: Run it to verify it fails**

Run: `bun test packages/devtools/tests/routes.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement it**

Read `application.routes` at request time for the mounted table, and join the compiled routes from the diagnostics for the module, controller and handler names. Sort by path, then method, then controller, then handler, then module, so the payload is deterministic.

- [ ] **Step 6: Run it to verify it passes**

Run: `bun test packages/devtools/tests/routes.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/devtools/src/endpoints/routes.ts packages/devtools/tests/routes.test.ts
git commit -m "feat(devtools): report the mounted route table"
```

---

### Task 7: `/__devtools/flow`

The endpoint the requester asked for by name. It publishes the stages each route passes through, with the ordinary guards and interceptors named, because the run that built them lowered them into a single compiled hook where their order would otherwise be invisible.

**Files:**

- Create: `packages/devtools/src/endpoints/flow.ts`
- Create: `packages/devtools/src/endpoints/flow.types.ts`
- Test: `packages/devtools/tests/flow.test.ts`

**Interfaces:**

- Consumes: the mounted application for the contributed hooks and validation slots, and `readApplicationDiagnostics` for the compiled route plans plus `globalEnhancers`.
- Produces: `buildFlowPayload(application, diagnostics): AponiaFlowPayload`, matching the spec's `stages` and `filters` shapes exactly.

- [ ] **Step 1: Write the failing test for the ordered stages**

```ts
test("a route's stages run in the order the code states", async () => {
  const payload = await (await fetch(`${url}/__devtools/flow`)).json();
  const route = payload.routes.find((entry: { id: string }) => entry.id === "GET /guarded");
  const kinds = route.stages.map((stage: { kind: string }) => stage.kind);

  expect(kinds).toEqual([
    "validate",
    "guard",
    "interceptBefore",
    "bind",
    "invoke",
    "handler",
    "interceptAfter",
  ]);
});
```

Adjust the expected list to the code you read: `derive`, `validate`, `resolve` and `hook` appear only when the route carries a plugin contribution or a schema slot, and a stage is published only when the route runs it.

- [ ] **Step 2: Write the enhancer-naming case**

```ts
test("a guard stage names the class it runs", () => {
  const guard = route.stages.find((stage: { kind: string }) => stage.kind === "guard");

  expect(guard.enhancer).toBe("AuthGuard");
  expect(guard.scope).toBe("local");
});
```

The spec's whole reason for adding the `enhancer` field is that the compiled hook cannot be read apart; a stage that does not name its class is a stage that tells a reader nothing.

- [ ] **Step 3: Write the filters case**

```ts
test("filters are a list on the route, ordered as the error array is, and never a stage", () => {
  expect(route.filters.map((filter: { name: string }) => filter.name)).toEqual([
    "NotFoundFilter",
    "ProblemDetailsMapping",
  ]);
  expect(route.stages.some((stage: { kind: string }) => stage.kind === "filter")).toBe(false);
});
```

- [ ] **Step 4: Write the graph-shape case**

```ts
test("every next names a stage the same route declares, and no stage is unreachable", () => {
  const ids = new Set(route.stages.map((stage: { id: string }) => stage.id));
  const first = route.stages[0].id;
  const reachable = new Set<string>();

  for (const stage of route.stages) {
    for (const next of stage.next) {
      expect(ids.has(next)).toBe(true);
    }
  }
  const queue = [first];
  while (queue.length > 0) {
    const current = queue.pop() as string;
    if (reachable.has(current)) {
      continue;
    }
    reachable.add(current);
    const stage = route.stages.find((entry: { id: string }) => entry.id === current);
    queue.push(...(stage?.next ?? []));
  }

  expect([...reachable].sort()).toEqual([...ids].sort());
});
```

The point is that `next` is checked against the route's own stages and every stage is reached from the first, rather than the chain being taken on trust.

- [ ] **Step 5: Write the anonymous-hook case**

A plugin-contributed hook has no name to report: Elysia identifies it by `subType`, `scope` and a `checksum`. Assert such a stage carries `hook` and **no** `enhancer`, and that the same contributed hook reaching two routes reports the same `hook` value.

- [ ] **Step 6: Run it to verify it fails**

Run: `bun test packages/devtools/tests/flow.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implement it**

Build the stages from two sources and merge them in the order the spec states. The contributed hooks and validation slots come from the mounted route entry — `hooks.transform`, `hooks.beforeHandle`, and the `params`/`query`/`body` schemas Elysia already holds. The route's own enhancers come from its compiled plan, because the platform lowered its guards and interceptors into one `beforeHandle` and one `afterHandle` and the plan is the only place their order is still separate. Publish a compiled hook as its parts, never as a `hook` stage.

The `model` field is populated when the plan's schema slot names a `@Validation()` class. Task 2 Step 1 established whether that name is reachable; use what it found rather than adding a field.

- [ ] **Step 8: Run it to verify it passes**

Run: `bun test packages/devtools/tests/flow.test.ts`
Expected: PASS, all six cases.

- [ ] **Step 9: Commit**

```bash
git add packages/devtools/src/endpoints/flow.ts packages/devtools/src/endpoints/flow.types.ts packages/devtools/tests/flow.test.ts
git commit -m "feat(devtools): report the stages each route passes through"
```

---

### Task 8: `/__devtools/logs`

**Files:**

- Create: `packages/devtools/src/logging/log-buffer.ts`, `packages/devtools/src/logging/log-buffer.types.ts`
- Create: `packages/devtools/src/endpoints/logs.ts`
- Modify: `packages/devtools/src/server/devtools-server.ts` (tap the application's logger)
- Test: `packages/devtools/tests/logs.test.ts`

**Interfaces:**

- Consumes: `LoggerService` from `@aponiajs/common`.
- Produces: `createLogBuffer(capacity): LogBuffer` where `LogBuffer` = `{ write(entry: LogEntry): void; since(cursor: number): { cursor: number; entries: readonly LogEntry[] } }` and `LogEntry` = `{ level: string; context: string; message: string; timestamp: string }`; `buildLogsPayload(buffer, since): AponiaLogsPayload`.

- [ ] **Step 1: Write the failing test**

```ts
test("logs returns entries after the cursor and a cursor to pass back", async () => {
  const first = await (await fetch(`${url}/__devtools/logs`)).json();
  expect(first.cursor).toBeGreaterThanOrEqual(0);

  // Cause one more log line, then read from the previous cursor.
  const second = await (await fetch(`${url}/__devtools/logs?since=${first.cursor}`)).json();
  expect(
    second.entries.every((entry: { timestamp: string }) => typeof entry.timestamp === "string"),
  ).toBe(true);
});
```

- [ ] **Step 2: Write the boundedness case — Review Focus item 4**

```ts
test("a since beyond the retained window returns what is retained, not an error", async () => {
  const response = await fetch(`${url}/__devtools/logs?since=999999`);

  expect(response.status).toBe(200);
  const payload = await response.json();
  expect(payload.cursor).toBeLessThanOrEqual(999999);
});
```

And a case writing more entries than the capacity, asserting the buffer holds exactly the capacity and the oldest are gone.

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test packages/devtools/tests/logs.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement the buffer and the endpoint**

A fixed-capacity ring buffer with a monotonic cursor. `write` drops the oldest past capacity. `since(cursor)` returns everything written after that cursor, or everything retained when the cursor is older than the window — never an error, and never a cursor that goes backwards.

- [ ] **Step 5: Run it to verify it passes**

Run: `bun test packages/devtools/tests/logs.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/devtools/src/logging packages/devtools/src/endpoints/logs.ts packages/devtools/tests/logs.test.ts
git commit -m "feat(devtools): publish a bounded log stream"
```

---

### Task 9: `/__devtools/requests`

The other half of the question. Every endpoint before this one publishes what the application **is**; this one publishes what it **did**. It comes straight after `/logs` because it is the same bounded ring buffer and the same cursor over a different record, and the two are what a developer reads together when a request misbehaves.

**Files:**

- Create: `packages/devtools/src/buffer/ring-buffer.ts`, `packages/devtools/src/buffer/ring-buffer.types.ts`
- Modify: `packages/devtools/src/logging/log-buffer.ts` (build the log buffer on the shared ring)
- Create: `packages/devtools/src/requests/request-buffer.ts`, `packages/devtools/src/requests/request-buffer.types.ts`
- Create: `packages/devtools/src/requests/request-capture.ts`
- Create: `packages/devtools/src/endpoints/requests.ts`
- Modify: `packages/devtools/src/endpoints/payloads.types.ts` (add this endpoint's payload type)
- Modify: `packages/devtools/src/module/devtools-module.ts`, `packages/devtools/src/module/devtools-module.types.ts` (add `capture` to `DevtoolsOptions` and contribute the capture hook)
- Modify: `packages/devtools/src/server/devtools-server.ts` (serve the endpoint from the buffer)
- Modify: `scripts/source-layout.spec.ts` (add the package's new domain directories)
- Test: `packages/devtools/tests/requests.test.ts`

**Interfaces:**

- Consumes: `DevtoolsOptions.capture` (Task 3), the plugin instance Task 3 and Task 4 give the server, and Task 8's buffer shape.
- Produces: `createRingBuffer<TItem>(capacity): RingBuffer<TItem>`, where `RingBuffer<TItem>` = `{ write(item: TItem): void; since(cursor: number): { cursor: number; entries: readonly TItem[] } }`;
  `createRequestBuffer(capacity): RequestBuffer`, a `RingBuffer<RequestRecord>`, where `RequestRecord` = `{ method: string; path: string; url: string; status: number; durationMs: number; timestamp: string; error?: string; headers?: Readonly<Record<string, string>>; body?: string }`;
  `resolveCapture(capture: DevtoolsOptions["capture"]): ResolvedCapture` and `toRequestRecord(context, capture, arrival, serves): Promise<RequestRecord>`, where `RequestArrival` = `{ timestamp: string; startedAt: number }`;
  `buildRequestsPayload(buffer, since): AponiaRequestsPayload`.

The ring is extracted rather than copied: `/logs` and `/requests` are one bounded cursor buffer with two item types, and a second copy under `requests/` would be the same mechanics written twice. Task 8's own tests must keep passing unchanged after the move, which Step 11 runs.

**A closed module adds nothing to the request path.** The hook below belongs to the plugin, so the absent case is the one **Task 3** already proves: a disabled `DevtoolsModule` returns an inert module with no plugin registered, so no hook, no buffer, and no record exist and the request path is exactly what it would be without the package. Nothing here re-tests that, because there is nothing to observe — a plugin that is not mounted contributes nothing to a request.

- [ ] **Step 1: Write the failing test for the buffer and the cursor contract**

```ts
test("the buffer keeps its capacity and its cursor never goes backwards", () => {
  const buffer = createRequestBuffer(2);
  const entry = (url: string): RequestRecord => ({
    method: "GET",
    path: url,
    url,
    status: 200,
    durationMs: 1,
    timestamp: "2026-09-26T00:00:00.000Z",
  });

  buffer.write(entry("/one"));
  buffer.write(entry("/two"));
  buffer.write(entry("/three"));

  // The oldest past capacity is gone, and the cursor counts what was written.
  expect(buffer.since(0).entries.map((record) => record.url)).toEqual(["/two", "/three"]);
  expect(buffer.since(0).cursor).toBe(3);

  // A cursor beyond the write count returns nothing rather than an error.
  expect(buffer.since(999).entries).toEqual([]);
  expect(buffer.since(999).cursor).toBe(3);
});
```

- [ ] **Step 2: Write the entry-shape case: the pattern in `path`, the query string in `url`**

```ts
test("an entry reports the route pattern and the URL that arrived", async () => {
  await fetch(`${applicationUrl}/users/42?expand=true`, { headers: { "x-trace-id": "abc" } });

  const payload = await (await fetch(`${url}/__devtools/requests`)).json();
  const entry = payload.entries.find((record: { path: string }) => record.path === "/users/:id");

  expect(entry.method).toBe("GET");
  expect(entry.url).toBe("/users/42?expand=true");
  expect(entry.status).toBe(200);
  expect(typeof entry.durationMs).toBe("number");
  expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  expect(entry.headers["x-trace-id"]).toBe("abc");
  // The route parses no body, so the record carries none.
  expect(Object.hasOwn(entry, "body")).toBe(false);
});
```

`url` is the path and query string, never an origin: a consumer joins it to the application's own base.

- [ ] **Step 3: Write the no-route case**

```ts
test("a request that matched no route is recorded without a route identity", async () => {
  await fetch(`${applicationUrl}/nope?x=1`);

  const payload = await (await fetch(`${url}/__devtools/requests`)).json();
  const entry = payload.entries.find((record: { url: string }) => record.url === "/nope?x=1");
  const routes = await (await fetch(`${url}/__devtools/routes`)).json();

  expect(entry.status).toBe(404);
  expect(entry.path).toBe("/nope");
  // The path that arrived is not a pattern the table serves.
  expect(routes.routes.some((route: { path: string }) => route.path === entry.path)).toBe(false);
});
```

Cover both refusals the spec names: a path nothing serves, and one a plugin's own `onRequest` refuses.

- [ ] **Step 4: Write the opt-out cases**

```ts
test("capture false records nothing", async () => {
  await fetch(`${applicationUrl}/users/42`);

  const payload = await (await fetch(`${url}/__devtools/requests`)).json();

  expect(payload.entries).toEqual([]);
  expect(payload.cursor).toBe(0);
});

test("headers false and body false leave their field out of the entry", async () => {
  await fetch(`${applicationUrl}/users`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-trace-id": "abc" },
    body: JSON.stringify({ name: "ada" }),
  });

  const payload = await (await fetch(`${url}/__devtools/requests`)).json();
  const entry = payload.entries[0];

  expect(Object.hasOwn(entry, "headers")).toBe(false);
  expect(Object.hasOwn(entry, "body")).toBe(false);
  // The fields that are not captured are not optional metadata: the rest of the
  // entry is unchanged, so a consumer reads it the same way either way.
  expect(entry.method).toBe("POST");
  expect(entry.status).toBe(201);
});
```

Boot one application per option set; `capture: false` must leave the module otherwise working, with `/requests` answering an empty buffer rather than `404`.

- [ ] **Step 5: Write the truncation and redaction cases**

```ts
test("a body longer than bodyLimit is cut and marked", async () => {
  await fetch(`${applicationUrl}/users`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "ada" }),
  });

  const payload = await (await fetch(`${url}/__devtools/requests`)).json();
  const entry = payload.entries[0];

  expect(entry.body.endsWith("[truncated]")).toBe(true);
  // The limit governs the body; the marker is appended to the stored value.
  expect(entry.body).toHaveLength(16 + "[truncated]".length);
});

test("redact replaces a named header with the literal, whatever its case", async () => {
  await fetch(`${applicationUrl}/users/42`, {
    headers: { authorization: "Bearer secret", "x-trace-id": "abc" },
  });

  const payload = await (await fetch(`${url}/__devtools/requests`)).json();
  const entry = payload.entries[0];

  // The options name the header in its canonical case; it arrives lowercased.
  expect(entry.headers.authorization).toBe("[redacted]");
  expect(entry.headers["x-trace-id"]).toBe("abc");
});
```

Boot the first with `capture: { bodyLimit: 16 }` and the second with `capture: { redact: ["Authorization"] }`, and assert the header is present-and-redacted rather than absent.

- [ ] **Step 6: Write the failure case**

```ts
test("a failure carries the message the answer published, and an answer carries none", async () => {
  await fetch(`${applicationUrl}/explodes`);
  await fetch(`${applicationUrl}/nope`);

  const payload = await (await fetch(`${url}/__devtools/requests`)).json();
  const failed = payload.entries.find((record: { url: string }) => record.url === "/explodes");
  const missing = payload.entries.find((record: { url: string }) => record.url === "/nope");

  expect(failed.status).toBe(500);
  expect(failed.error).toBe("The database is unreachable.");
  // A 4xx is an answer rather than a failure.
  expect(missing.status).toBe(404);
  expect(Object.hasOwn(missing, "error")).toBe(false);
});
```

The `/explodes` handler in the fixture throws `httpErrors.internalServerError("The database is unreachable.")`, so the assertion pins an application's own message rather than the platform's wording for an unhandled failure.

- [ ] **Step 7: Verify what the hooks can see, before writing them**

Write a scratch probe — one `.ts` file run with `bun`, never committed — that mounts a plugin carrying `.onRequest` and `.onAfterResponse` the way `ElysiaPluginModule.register` mounts the devtools plugin, beside a route on the root instance, a route that throws, and a path nothing serves. Answer these three, and put the answers in the commit body of Step 12 rather than in a comment:

1. **Do the plugin's hooks run for a route the plugin does not own?** The devtools plugin is mounted before the controllers' routes, and the record has to cover all of them. If the default scope does not reach them, use the option the installed Elysia exposes — `MacroOptions.stack` is `'global' | 'local'` in 1.4.30 — rather than registering anything on the root application, which this package does not do.
2. **What does the after-response context carry for a failure?** The status, and the value the published message is read from. `error` comes from the answer and never from the exception, because this package registers no error hooks.
3. **Does the after-response hook run for a request that matched no route?** If it does, the entry is completed exactly like any other and the probe settles the question. If it does not, the entry is what the arrival hook witnessed — method, the path that arrived, the headers, and the status the answer carried — and if even that cannot be reached without mocking the lifecycle under test, say so in the report rather than adding a second mechanism to guess at it.

Also confirm the pair never changes a request: a route that reads its body must behave identically with the hooks registered, which is the claim `/requests` makes about itself.

- [ ] **Step 8: Run it to verify it fails**

Run: `bun test packages/devtools/tests/requests.test.ts`
Expected: FAIL — the endpoint answers `404` and the buffer does not exist.

- [ ] **Step 9: Extract the ring, and build both buffers on it**

```ts
// buffer/ring-buffer.ts
export function createRingBuffer<TItem>(capacity: number): RingBuffer<TItem> {
  const items: TItem[] = [];
  let written = 0;

  return {
    write(item) {
      items.push(item);
      written += 1;
      if (items.length > capacity) {
        items.shift();
      }
    },
    since(cursor) {
      // The cursor of the oldest retained item: a caller older than it reads
      // what is retained rather than an error, and never a cursor that went back.
      const oldest = written - items.length;
      const from = Math.max(cursor - oldest, 0);

      return Object.freeze({
        cursor: written,
        entries: Object.freeze(items.slice(from)),
      });
    },
  };
}
```

`logging/log-buffer.ts` becomes that call with `LogEntry`, `requests/request-buffer.ts` the same with `RequestRecord`, and both keep the exact shape Task 8 published. No behavior changes: a log buffer that dropped or duplicated an entry on the way would be caught by Task 8's tests, which Step 11 runs.

- [ ] **Step 10: Write the capture policy and the endpoint**

```ts
// requests/request-capture.ts
const redactedValue = "[redacted]";
const truncatedMarker = "[truncated]";
const defaultBodyLimit = 16384;

export function resolveCapture(capture: DevtoolsOptions["capture"]): ResolvedCapture {
  if (capture === false) {
    return Object.freeze({
      enabled: false,
      headers: false,
      body: false,
      bodyLimit: 0,
      redact: Object.freeze([]),
    });
  }

  const options = capture ?? {};

  return Object.freeze({
    enabled: options.enabled ?? true,
    headers: options.headers ?? true,
    body: options.body ?? true,
    bodyLimit: options.bodyLimit ?? defaultBodyLimit,
    redact: Object.freeze((options.redact ?? []).map((name) => name.toLowerCase())),
  });
}

function captureHeaders(
  headers: Headers,
  redact: readonly string[],
): Readonly<Record<string, string>> {
  const captured: Record<string, string> = {};

  for (const [name, value] of headers) {
    captured[name] = redact.includes(name) ? redactedValue : value;
  }

  return Object.freeze(captured);
}

function captureBody(body: unknown, limit: number): string | undefined {
  if (typeof body === "string") {
    return body.length > limit ? `${body.slice(0, limit)}${truncatedMarker}` : body;
  }
  if (body === undefined || body === null) {
    return undefined;
  }

  const serialized = JSON.stringify(body) ?? "";
  return serialized.length > limit ? `${serialized.slice(0, limit)}${truncatedMarker}` : serialized;
}
```

`toRequestRecord` assembles the entry from the after-response context: `method` and the headers from `context.request`, `url` as `pathname + search` from that request's own URL, `status` from the context, `durationMs` against the arrival stamp, `timestamp` as that arrival's ISO 8601 string, and the three optional fields added only when there is something to add — never written as `undefined`, which is what makes an opt-out observable on the wire. `set.status` may carry a status name rather than a number, and the record stores the number the answer went out with.

`path` is the pattern when the application mounted one and the path that arrived when it did not, which is what Step 7 settles: Elysia answers a request nothing matched through its own path, where `route` is not a route this application serves, so the mounted table is the test.

```ts
// requests/request-capture.ts
/** The message the answer published, and never the exception's. */
async function failureMessage(context: AfterResponseContext): Promise<string | undefined> {
  const status = context.set.status;
  if (typeof status !== "number" || status < 500) {
    return undefined;
  }

  // Step 7 settles which of the two the installed Elysia hands this hook: the
  // value the answer carried, or the `Response` the mapping returned.
  const answer =
    context.responseValue instanceof Response
      ? await context.responseValue.clone().json()
      : context.responseValue;
  const detail = (answer as { readonly detail?: unknown } | null | undefined)?.detail;

  return typeof detail === "string" ? detail : undefined;
}

export async function toRequestRecord(
  context: AfterResponseContext,
  capture: ResolvedCapture,
  arrival: RequestArrival,
  serves: (route: string) => boolean,
): Promise<RequestRecord> {
  const url = new URL(context.request.url);
  const matched = context.route !== "" && serves(context.route);
  const body = capture.body ? captureBody(context.body, capture.bodyLimit) : undefined;
  const error = await failureMessage(context);

  return Object.freeze({
    method: context.request.method,
    path: matched ? context.route : url.pathname,
    url: `${url.pathname}${url.search}`,
    status: typeof context.set.status === "number" ? context.set.status : 200,
    durationMs: performance.now() - arrival.startedAt,
    timestamp: arrival.timestamp,
    ...(capture.headers
      ? { headers: captureHeaders(context.request.headers, capture.redact) }
      : {}),
    ...(body === undefined ? {} : { body }),
    ...(error === undefined ? {} : { error }),
  });
}
```

`endpoints/requests.ts` is `buildRequestsPayload(buffer, since)` — the buffer's `since`, wrapped in the frozen payload `/logs` already returns in the same situation — and `devtools-server.ts` gains it in the same handlers record as every other endpoint.

- [ ] **Step 11: Contribute the hook from the plugin, and run it**

The plugin created in Task 3 gains the pair `request-capture.ts` returns, and hands the same buffer the server reads to `startDevtoolsServer`. The arrival hook stamps the request in a `WeakMap` keyed by the arriving `Request` — no mutation of the request, and nothing retained past the response — and the after-response hook writes the entry when the policy's `enabled` is true. A request the arrival hook never saw, and a response the after-response hook never reaches, leave nothing rather than a partial entry.

Run: `bun test packages/devtools/tests/requests.test.ts packages/devtools/tests/logs.test.ts`
Expected: PASS. The logs case passing unchanged is what says the ring extraction changed nothing.

- [ ] **Step 12: Commit**

```bash
git add packages/devtools/src packages/devtools/tests/requests.test.ts scripts/source-layout.spec.ts
git commit -m "feat(devtools): record the requests the application answers" -m "<the three answers Step 7 established>"
```

---

### Task 10: `/__devtools/aot`, with the analysis imported lazily

**Files:**

- Create: `packages/devtools/src/endpoints/aot.ts`, `packages/devtools/src/endpoints/aot.types.ts`
- Modify: `packages/devtools/package.json` (add `@aponiajs/cli` as a dependency)
- Test: `packages/devtools/tests/aot.test.ts`

**Interfaces:**

- Consumes: `readApplicationDiagnostics` for `graph`, `invokers.accepted` and `invokers.reason`; `@aponiajs/cli`'s exported analysis, dynamically imported.
- Produces: `buildAotPayload(diagnostics, analysis): AponiaAotPayload`.

- [ ] **Step 1: Write the failing test for the framework half**

```ts
test("aot reports the boot decision without loading the analyzer", async () => {
  const payload = await (await fetch(`${url}/__devtools/aot`)).json();

  expect(payload.graph).toBe("decorated");
  expect(payload.invokers.accepted).toBe(false);
  expect(payload.invokers.reason).toBeDefined();
});
```

This case must pass with no source project present, because the framework facts do not need one.

- [ ] **Step 2: Write the lazy-import case**

```ts
test("the analyzer loads on first request and is cached", async () => {
  const before = await (await fetch(`${url}/__devtools/aot`)).json();
  const after = await (await fetch(`${url}/__devtools/aot`)).json();

  expect(after.controllers).toEqual(before.controllers);
});
```

Then a case asserting the module is **not** imported at boot: `bun`'s module registry can be read through `require.cache`-equivalent means per runtime, so if there is no clean way to observe it, assert instead that booting an application whose project has no source root still answers the endpoint with the framework fields and an empty controller list, rather than failing.

- [ ] **Step 3: Write the degradation case — Review Focus item 5**

```ts
test("an analyzer that cannot load degrades one field group, not the endpoint", async () => {
  const payload = await (await fetch(`${url}/__devtools/aot`)).json();

  expect(payload.graph).toBeDefined();
  expect(payload.controllers).toEqual([]);
});
```

Prove the failure path with a mutation rather than a mock if the dynamic import can be made to throw; if it cannot be reached from a test without mocking the module whose behaviour is under test, say so in the report instead of writing a mock that asserts nothing.

- [ ] **Step 4: Run it to verify it fails**

Run: `bun test packages/devtools/tests/aot.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement it**

Serve the framework facts immediately. On the first request to this endpoint, `await import("@aponiajs/cli")`, run the analysis against the project root, cache the result for the process lifetime, and answer. If the import or the analysis throws, answer with the framework facts and an empty controller list, and log under `Devtools`.

- [ ] **Step 6: Run it to verify it passes**

Run: `bun test packages/devtools/tests/aot.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/devtools/src/endpoints packages/devtools/package.json
git commit -m "feat(devtools): report the build-time verdicts behind a lazy import"
```

---

### Task 11: Documentation and repository gates

**Files:**

- Create: `docs/devtools.md`, `packages/devtools/tests-vp/devtools.conformance.ts`
- Modify: `packages/devtools/README.md`, `packages/devtools/AGENTS.md`
- Modify: `docs/packages.md` (a row), `docs/AGENTS.md` (a row), root `AGENTS.md` (the package list and the implemented-scope list)
- Modify: `packages/devtools/llms.txt` if the workspace convention requires one for a publishable package — check `scripts/package-llms.spec.ts` and add it when the guard requires it

- [ ] **Step 1: Write `docs/devtools.md`**

Cover: what the package is and is not; registration and the `enabled` decision; the forced loopback address and why it is not configurable; the seven endpoints and the `contract` field; the log cursor; what the request record captures by default and the opt-outs that turn it off, including `capture.redact`; the accepted limitations, copied from the spec rather than restated; and that the consumer builds the UI.

- [ ] **Step 2: Write the conformance file**

The Vite+ lane mirrors the public contract: `DevtoolsOptions`, the payload types, and that the module's registration result is assignable where an application import expects it. Types only — the runtime behaviour runs over a socket the conformance lane has no business opening.

- [ ] **Step 3: Update the guides and the catalogues**

Add the package's domain rows to `packages/devtools/AGENTS.md`, a row to `docs/packages.md` and `docs/AGENTS.md`, and index the guide from the root `AGENTS.md`. Move nothing else: the enhancer entries in the root implemented-scope list were settled by the previous run.

- [ ] **Step 4: Verify the coverage gate sees the new sources**

Run: `bun run test:coverage`

Then confirm each file under `packages/devtools/src` appears in the LCOV report. The discovery in `scripts/coverage-gate.ts` globs `packages/*/src/**/*.ts`, so a new package should be found automatically — if it is not, add the entry the spec calls for and say so.

- [ ] **Step 5: Run the complete gate set**

```bash
bun run check
bun run test:coverage
bun run test:vite-plus
bun run test:examples
bun test scripts/
```

Expected: all pass, aggregate line and function coverage at or above 95%.

- [ ] **Step 6: Scan for non-English content and commit**

```bash
rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .
git add docs packages AGENTS.md
git commit -m "docs(devtools): document the loopback API and the contract"
```
