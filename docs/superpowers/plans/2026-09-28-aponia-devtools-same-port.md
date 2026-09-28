# Devtools on the Application's Own Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@aponiajs/devtools` serves its seven endpoints from the application it reports on, under
`/__devtools`, on the application's own port — and the separate `Bun.serve` socket, the `port` and
`host` options, and the loopback machinery that existed to protect that socket are removed.

**Architecture:** The plugin already builds a pure dispatcher, `routeRequest(request, handlers)`,
which decides a method and a path without a socket. It mounts one wildcard route,
`/__devtools/*`, whose handler forwards the request to that dispatcher, so the documented `404` and
`405` answers are produced by the same code as before. The handlers read the reports they publish at
request time, and the one thing they cannot read from the request context — the native application
itself — is published on the application's own `store` by the boot, the way the boot record is
published on the instance.

**Tech Stack:** TypeScript (strict, ESM), Elysia 1.4.30, Bun test, Vite+ conformance.

**Spec:** the decision is the repository owner's, given as two answers: the surface must use the
application's port, with the separate socket removed entirely; and `/requests` keeps recording
headers and bodies with no warning, because this is a development surface rather than a production
one. `docs/devtools.md` is the reference page this plan rewrites; `packages/devtools/AGENTS.md`
holds the invariants.

## What this plan settles before Task 1, each measured rather than assumed

1. **A plugin mounted through the factory's `plugins` option can register routes at registration
   time, and those routes answer.** Measured: a plugin whose body calls
   `.all("/__devtools/*", handler)` answers `200` at that path, while an application route beside it
   still answers. `onStart` is not needed to mount anything.
2. **The mount works under `application.handle` as well as under `listen`.** Measured: with
   `onStart` never firing, `application.handle(new Request(".../__devtools/meta"))` answered `200`.
   This is a gain rather than a detail: the surface becomes testable through the entrypoint this
   repository tells tests to prefer, and the package's own tests stop needing a socket.
3. **The documented `404`/`405` contract survives the wildcard mount.** Measured against the real
   dispatcher: `GET /__devtools/meta` → `200`, `GET /__devtools/nope` → `404`, `GET /__devtools`
   (the bare prefix) → `404`, `POST /__devtools/meta` → `405` with `allow: GET`.
4. **An application route that claims a devtools path wins.** Measured: with both the plugin's
   wildcard and a controller route declaring `/__devtools/meta`, the answer came from the
   controller. The rule is stated and pinned rather than left to whichever registers first.
5. **The request context does not carry the application.** Measured: its keys are
   `path, qi, redirect, request, server, set, status, store, url`. Three endpoints (`/graph`,
   `/routes`, `/flow`) need the native application, and `onStart` — the only hook that receives it —
   does not fire for an application that never calls `listen`. So the boot publishes the
   application on its own `store` under a registered symbol, beside the two instance seams it
   already attaches, and a handler that finds nothing there reports the absence the way the
   existing seam does.

## What this plan removes, and what the removal costs

`docs/devtools.md` currently opens with the property this plan gives up, in its own words: _"The
devtools server is a separate `Bun.serve` socket. It registers no route on the application, so it
can be enabled, disabled, or fall over without changing a single answer the application gives."_
Mounting the surface on the application ends that property: the surface is now part of the route
table, and a request to `/__devtools/...` is answered by the application rather than by 404.

The loopback default and its warning row go with it. Their stated reason — _"a debugging aid should
not be reachable by default"_, because `/requests` records headers and bodies — is replaced by the
owner's decision: this surface runs in development, `enabled` is how an application keeps it out of
production, and `/requests` records everything with no warning. Documentation must say the new
exposure plainly rather than keeping the old rationale in softened form: wherever the application is
reachable, the surface is reachable, and what it serves includes recorded headers and bodies.

Removed from the package's public surface: `startDevtoolsServer`, `DevtoolsServer`,
`DevtoolsServerOptions`, and the `port` and `host` options. That is a breaking change, which the
alpha channel carries.

## Global Constraints

- Every file, comment, and document is English. Before finishing a task:
  `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`
- **Branch `feature/devtools-same-port`, cut from `feature/example-applications`** so that the
  example this plan must update is in scope. That branch's pull request (#56) is green and
  mergeable; if it lands first, rebase this branch onto `release/alpha` and the example arrives
  with it.
- No push and no version bump until the last task, which does both.
- `routeRequest` stays pure and stays exported: it is what keeps `404`/`405` testable without a
  socket, and what this plan asserts against directly.
- Both test lanes move together. `packages/devtools/tests/*.test.ts` (Bun) and
  `packages/devtools/tests-vp/*.conformance.ts` (Vite+) are mirrored, and a public contract change
  needs a case in each.
- Gates per task: `bun run check`, `bun run --filter @aponiajs/devtools test`, and the lane the
  task names. The packed lane (`bun run test:generated-app`) is the acceptance test for the starter
  change.
- Markdown tables are formatter-owned: `bun run check --fix`, then re-verify.
- Commit bodies explain why the change is right and end with
  `Co-Authored-By: Claude Code <noreply@anthropic.com>`.

## Review Focus

Six inputs and conditions this change implies and no task's prose would otherwise cover.

1. **The application's own answer to a devtools path.** Measured as "the application wins"; the
   rule must be stated in the docs and pinned by a case, because the two owners of that path are
   now in one route table. (Task 1)
2. **A hand-built application that never booted.** The store carries nothing, so the endpoints that
   need the application have no report to give. The answer must be the documented degraded one, not
   a throw and not an empty `200`. (Task 1)
3. **`/requests` on a published port.** The owner accepted the exposure; the documentation must
   state it, and nothing may quietly reintroduce a warning that contradicts the decision. (Task 3)
4. **The starter's `.env.example`, README, and guide.** They name `DEVTOOLS_PORT` and `host`, both
   of which disappear; a generated application that still sets them would read options the package
   no longer declares. (Task 2)
5. **The packed lane's devtools assertion.** It currently proves the option path reached a generated
   application by fetching the devtools socket. With no socket, the assertion has to read the
   surface through the application's own address, or it stops proving anything. (Task 2)
6. **`enabled: false` still meaning something.** It used to mean no socket; it must now mean no
   route, and the case that pins it has to say so in the same terms. (Task 1)

---

### Task 1: The package serves from the application

**Files:**

- Modify: `packages/platform-elysia/src/application/application-bootstrap.ts` (publish the
  application on its own store)
- Modify: `packages/platform-elysia/src/application/application-container.ts` (the registered
  symbol and its reader, beside the container seam)
- Modify: `packages/devtools/src/module/devtools-module.ts` (mount instead of serving)
- Modify: `packages/devtools/src/module/devtools-module.types.ts` (drop `port` and `host`)
- Modify: `packages/devtools/src/server/devtools-server.ts` (handlers stay, socket goes)
- Modify: `packages/devtools/src/server/devtools-server.types.ts` (drop `DevtoolsServer`)
- Modify: `packages/devtools/src/index.ts` (drop the removed exports)
- Modify: `packages/devtools/tests/*.test.ts` (ten files, of which seven start a socket today; the
  other three change only where the module they exercise changed)
- Modify: `packages/devtools/tests-vp/*.conformance.ts`
- Modify: `packages/devtools/AGENTS.md`

**Interfaces:**

- Consumes: `routeRequest`, the seven payload builders, `devtoolsPathPrefix`, and the log and
  request buffers, all of which already exist.
- Produces: `devtoolsPlugin(options)` and `DevtoolsModule.register(options)` that mount the surface
  on the application; a boot that publishes its application on `application.store` under
  `Symbol.for("aponia.application.native")`.

- [ ] **Step 1: Measure the store as the channel before wiring it**

Run a probe in `examples/devtools/` (its `tsconfig.json` maps `@aponiajs/*` at sources) that mounts
a plugin reading `context.store`, records what the store holds at request time, and confirms a value
the factory wrote at boot is visible there. Report the observed keys. If the store is not shared the
way the probe expects, stop and report rather than falling back to a module-level variable: a
module-level application reference is a second source of truth for a fact the boot already decided.

- [ ] **Step 2: Write the failing tests**

In `packages/devtools/tests/devtools-module.test.ts`, replace the socket-based cases with cases that
boot an application and drive the surface through `application.handle(new Request(...))`:

```ts
test("serves its endpoints on the application's own address", async () => {
  const application = await bootWithDevtools();

  const meta = await application.handle(new Request(`http://localhost${devtoolsPathPrefix}/meta`));

  expect(meta.status).toBe(200);
  expect(await meta.json()).toMatchObject({ contract: 2 });
});

test("answers 404 for a path it does not own and 405 for a method it does not serve", async () => {
  const application = await bootWithDevtools();

  const unknown = await application.handle(
    new Request(`http://localhost${devtoolsPathPrefix}/nope`),
  );
  const wrongMethod = await application.handle(
    new Request(`http://localhost${devtoolsPathPrefix}/meta`, { method: "POST" }),
  );

  expect(unknown.status).toBe(404);
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.get("allow")).toBe("GET");
});

test("an application route that claims a devtools path answers it", async () => {
  const application = await bootWithDevtools({
    controller: controllerAnswering(`${devtoolsPathPrefix}/meta`),
  });

  const response = await application.handle(
    new Request(`http://localhost${devtoolsPathPrefix}/meta`),
  );

  expect(await response.json()).toEqual({ from: "application" });
});

test("a disabled registration mounts no route at all", async () => {
  const application = await bootWithDevtools({ enabled: false });

  const response = await application.handle(
    new Request(`http://localhost${devtoolsPathPrefix}/meta`),
  );

  expect(response.status).toBe(404);
});
```

Add a case for the hand-built application: a bare `Elysia` with the plugin mounted but no boot
behind it answers the endpoints that need the application with the documented absence rather than a
throw.

- [ ] **Step 3: Run them to verify they fail**

Run: `bun run --filter @aponiajs/devtools test`
Expected: FAIL — the endpoints answer `404`, because today the plugin serves them from a socket that
`handle()` never starts.

- [ ] **Step 4: Publish the application on its own store**

In `packages/platform-elysia/src/application/application-container.ts`, beside the container seam
and in its style — a registered symbol, a non-enumerable-free plain store entry, and a reader that
answers `undefined` for an application no boot produced:

```ts
// The application's own `store` is the one channel a plugin mounted on it can read at request
// time: Elysia's request context carries `store` and not the instance, and `onStart` — the only
// hook that receives the instance — does not run for an application that never listens.
const nativeApplicationKey: unique symbol = Symbol.for("aponia.application.native");

/**
 * Publishes the application on its own store, so a plugin mounted on it can reach it while
 * answering a request.
 *
 * @internal
 */
export function publishApplicationOnStore(application: object): void {
  const store = (application as { store?: Record<PropertyKey, unknown> }).store;
  if (!store) {
    return;
  }

  Object.defineProperty(store, nativeApplicationKey, {
    value: application,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/**
 * The application a request is being answered by, or `undefined` when nothing published one.
 *
 * @internal
 */
export function readApplicationFromStore(store: unknown): object | undefined {
  return (store as Record<PropertyKey, unknown> | null | undefined)?.[nativeApplicationKey] as
    object | undefined;
}
```

Call `publishApplicationOnStore(nativeApplication)` in `bootstrapAponiaApplication`, beside
`attachApplicationDiagnostics`.

- [ ] **Step 5: Mount the surface instead of serving it**

In `packages/devtools/src/module/devtools-module.ts`, `createDevtoolsPlugin` keeps its capture hooks
and its log stream, and replaces the `onStart`/`onStop` socket pair with one route:

```ts
  return new Elysia({ name: devtoolsPluginName })
    .onRequest((context) => {
      capture.arrive(context.request, context.store);
    })
    .onAfterResponse({ as: "global" }, async (context) => {
      // (unchanged: the closing reading stays the hook's first statement)
      const completedAt = performance.now();
      await capture.complete({ ... }, completedAt);
    })
    .all(`${devtoolsPathPrefix}/*`, ({ request, store }) =>
      routeRequest(request, createHandlers(readApplicationFromStore(store), logs, capture)),
    );
```

`createHandlers` is what `startDevtoolsServer` already builds internally; it becomes the module's
function that answers a `DevtoolsHandlers` record for a given application (or `undefined`, which its
readers already tolerate for an application no boot produced). The `onStart` hook is reduced to one
log line naming where the surface is mounted; it is not what mounts it, and nothing may move the
mount into it.

Two facts `onStart` used to hand the capture move with it, and both need a home that a `handle()`-only
application reaches: the boot's record, which the handlers now read from the application at request
time rather than being handed at start; and `capture.beginBoot`, which associates the capture with
the boot's `mappedExceptions` table. Run `beginBoot` once per application, memoized in a `WeakMap`
keyed by the application, on the first request that reaches the surface — with a comment saying why
it cannot be an `onStart` call. If the implementer finds a fact that genuinely needs `onStart`, it
reports it rather than reintroducing one.

The mount path is stated once: `` `${devtoolsPathPrefix}/*` ``, with a comment saying the dispatcher
owns the `404` and the `405` so the wildcard is not read as a claim about every path.

- [ ] **Step 6: Remove what the socket needed**

Delete `devtoolsServer.ts`'s serve call and the loopback check with it, drop `port` and `host` from
`DevtoolsOptions`, delete `DevtoolsServer`, `DevtoolsServerOptions`, and `startDevtoolsServer`, and
remove them from `src/index.ts`. `devtoolsPathPrefix` and `routeRequest` stay exported. Keep
`host`'s warning row's neighbours: the report a refused bind wrote has no subject any more, and its
tests go with it.

- [ ] **Step 7: Run the tests and the gates**

Run: `bun run --filter @aponiajs/devtools test`
Expected: pass, with the new cases and every case that used to bind a socket now driving
`application.handle`.

Run: `bun run check`
Expected: clean. The removed exports make every stale reference a type error, which is how the
migration list is verified rather than trusted.

- [ ] **Step 8: Update the package's guide and commit**

`packages/devtools/AGENTS.md` loses the loopback invariants and the `Bun.serve` socket, and gains
the mount rule, the collision rule from Review Focus 1, and the store channel.

```bash
bun run check --fix
bun run --filter @aponiajs/devtools test
git add packages/devtools packages/platform-elysia
git commit -m "feat(devtools): serve the surface on the application's own port"
```

---

### Task 2: The starter and the packed lane

**Files:**

- Modify: `packages/cli/templates/application/src/main.ts.tmpl`
- Modify: `packages/cli/templates/application/.env.example`
- Modify: `packages/cli/templates/application/README.md`
- Modify: `packages/cli/templates/application/AGENTS.md`
- Modify: `packages/cli/templates/application/llms.txt`
- Modify: `packages/cli/e2e/generated-application.e2e.ts`
- Modify: `packages/cli/AGENTS.md`
- Test: `packages/cli/e2e/generated-application.e2e.ts`

**Interfaces:**

- Consumes: Task 1's `devtoolsPlugin` with no `port` and no `host`.
- Produces: a generated application whose devtools surface is served on `PORT`, and a packed lane
  that proves it.

- [ ] **Step 1: Update the template**

`main.ts.tmpl`: the `plugins` entry drops `port` and keeps `enabled` and `logger`; the comment that
explains the two boot-shaping reads keeps `NODE_ENV` and loses `DEVTOOLS_PORT`.

`.env.example`: drop `DEVTOOLS_PORT`, keep `PORT` and whatever else it carries.

`README.md` and `AGENTS.md`: the surface is served on the application's own port under
`/__devtools`; the seven endpoints are listed as they are now; the sentences naming loopback,
`DEVTOOLS_PORT`, and a second port change to the new truth. `AGENTS.md`'s sentence about handing one
logger object to both places stays — it still holds.

- [ ] **Step 2: Update the packed lane's assertion**

The lane currently proves the option path reached a generated application by fetching the devtools
socket. With no socket it must fetch the surface on the application's own port — the same server the
lane already boots and polls for the startup line — and assert a `200` from `/__devtools/meta`. A
lane that cannot fail when the registration is dropped is not an assertion; say in the report which
`200` it reads and why that request could not be answered by the application's own routes.

- [ ] **Step 3: Run the packed lane**

```bash
bun run build
find packages -name '*.d.ts' -path '*/src/*' -delete
bun run test:generated-app
```

Expected: pass. This lane also regenerates and compares the starter's committed descriptor artifact,
so it is the one that notices a template edit that was not carried through.

- [ ] **Step 4: Run the CLI's own lanes and commit**

```bash
bun run check --fix
bun test packages/cli/tests/
bun run test:generated-app
git add packages/cli
git commit -m "feat(cli): generate an application whose devtools share its port"
```

---

### Task 3: The example and every document that names the socket

**Files:**

- Modify: `examples/devtools/src/main.ts`
- Modify: `examples/devtools/test/application.ts`
- Modify: `examples/devtools/README.md`
- Modify: `docs/devtools.md`
- Modify: `docs/learn/14-devtools.md`
- Modify: `docs/cli.md`
- Modify: `docs/configuration.md`
- Modify: `docs/packages.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `packages/devtools/README.md`
- Modify: `packages/devtools/llms.txt`

**Interfaces:**

- Consumes: Tasks 1 and 2.
- Produces: an example that reserves one port, and documents that describe one address.

- [ ] **Step 1: The example reserves one port**

`src/main.ts` mounts `devtoolsPlugin({ enabled, logger: appLogger })` with no port; the application
listens on its own `PORT` (3110), and the surface answers there. `test/application.ts` reserves one
port instead of two, and its helper returns the application's origin plus the prefix rather than a
second address. `README.md`'s endpoint table loses the second port and the "binds loopback" row, and
gains the collision rule and the exposure sentence from Task 1's docs.

- [ ] **Step 2: Rewrite the reference page's opening and its accepted limitations**

`docs/devtools.md` opens by stating the socket; it now states the mount, the path, and the two
consequences the owner accepted: the surface is part of the application's route table, and it is
reachable wherever the application is. The loopback section, the `host` option row, the bind-warning
row, and the `port` option row go. `/requests` keeps recording headers and bodies as its default,
with no warning — and the page says why in the owner's terms: this is a development surface, and
`enabled` is how an application keeps it out of production.

- [ ] **Step 3: Sweep every remaining copy**

Measured list, each of which names the socket, `DEVTOOLS_PORT`, `host`, or a second address:
`docs/learn/14-devtools.md`, `docs/cli.md`, `docs/configuration.md` (the starter's boot-shaping
read), `docs/packages.md`, the root `README.md`'s scope paragraph, the root `AGENTS.md`'s scope
paragraph, `packages/devtools/README.md`, `packages/devtools/llms.txt`. Fix each in the wording of
the new truth, and grep for the removed words afterwards rather than trusting this list:
`rg -n "DEVTOOLS_PORT|Bun.serve|loopback|startDevtoolsServer|127\.0\.0\.1:8000"`.

- [ ] **Step 4: Run the lanes and commit**

```bash
bun run check --fix
bun run --cwd examples/devtools test
bun run test:examples
bun test scripts/
rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .
git add examples/devtools docs README.md AGENTS.md packages/devtools
git commit -m "docs(devtools): describe the surface the application serves itself"
```

---

### Task 4: The conformance lane, the release, and the pull request

**Files:**

- Modify: `packages/devtools/tests-vp/*.conformance.ts`

**Interfaces:**

- Consumes: every task before it.
- Produces: the verified branch, bumped and pushed with a pull request.

- [ ] **Step 1: Mirror the public contract in the conformance lane**

The Vite+ lane exists to hold public types and supported runtime behavior. The removed exports and
the changed option type are exactly that: a case asserting `devtoolsPlugin` accepts an options object
without `port` and `host`, and that the surface answers through `application.handle`, belongs there.
Add it to the conformance file the package already has rather than creating a second one.

- [ ] **Step 2: Run the whole-branch verification**

```bash
bun run check
bun run test:coverage
bun run test:vite-plus
bun run test:examples
bun run release:dry-run
bun run build
find packages -name '*.d.ts' -path '*/src/*' -delete
bun run test:generated-app
bun test scripts/
rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .
```

- [ ] **Step 3: Bump and push**

`bun run version:alpha` moves `0.6.0-alpha.32` to `0.6.0-alpha.33`; `scripts/documentation-versions.spec.ts`
then names the four published stamps that still carry the old release, and they move with it.

```bash
bun run version:alpha
bun test scripts/documentation-versions.spec.ts
git add -A
git commit -m "chore(release): bump every manifest to 0.6.0-alpha.33"
git push -u origin feature/devtools-same-port
gh pr create --base release/alpha --title "feat(devtools): serve the surface on the application's own port" --body-file .tmp/devtools-pr-body.md
```

The pull request body states the intent, the breaking removals, the affected packages, and the
validation results, as `AGENTS.md` requires. It must also state, in the owner's terms, that the
surface is now reachable wherever the application is and that `/requests` records headers and bodies
by default — a reviewer has to be able to see that this was decided rather than missed.

---

## Whole-branch verification

Task 4 Step 2 is the list. Two entries carry more weight than the rest: `test:generated-app` is the
only lane that reaches the starter's committed descriptor artifact and the only one that boots a
generated application, so it is the acceptance test for Task 2; and `test:coverage` fails if the
socket's removal left a source file behind that nothing exercises, which is how a half-removed
module is caught.

## What this plan does not do

- **Not a new endpoint, payload, or capture policy.** The seven endpoints, their payload contracts,
  the request and log buffers, and `capture`'s shape are unchanged; only where they are served from
  changes.
- **No authentication, no path secret, no production hardening.** The owner's decision is that this
  is a development surface; `enabled` remains the switch, and the docs say so.
- **No compatibility shim for `port`, `host`, or `startDevtoolsServer`.** They are removed rather
  than deprecated: the package is pre-1.0 on the alpha channel, and a shim would keep the socket
  alive in the code that exists to protect it.
- **No change to what the surface reports.** `/graph`, `/routes`, and `/flow` read the application
  through the new store channel instead of through `onStart`'s argument. One visible consequence
  follows from where the surface is served rather than from what it reports, and it is accepted
  rather than filtered: the mount is a route in the application's own table, so a devtools-enabled
  application's `/routes` and `/flow` carry one more row — `ALL /__devtools/*`, the surface's own
  mount. Excluding it would make the endpoint lie about a route the application answers, and
  `/routes` reports the mounted table rather than re-deriving it.
