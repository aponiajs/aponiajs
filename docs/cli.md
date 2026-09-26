# Aponia CLI

The CLI is published on npm as
[`@aponiajs/cli`](https://www.npmjs.com/package/@aponiajs/cli). The matching
[`create-aponia`](https://www.npmjs.com/package/create-aponia) package provides
the `bun create` entrypoint.

## Install

Install the CLI globally with Bun, then invoke `aponia` directly:

```bash
bun add --global @aponiajs/cli
aponia --version
```

## Design reference

The Aponia CLI follows the parts of the Nest CLI contract that fit a Bun-first
Elysia application:

- `new` is the standard application generator;
- `n` is its short alias;
- `--dry-run` and `-d` report changes without writing;
- `--skip-install` and `-s` create files without installing dependencies;
- `generate` and `g` expose the complete built-in Nest schematic catalog;
- generated declarations are registered in the nearest module by default;
- generated projects use a canonical source root and a small bootstrap file;
- project metadata lives in `aponia.json`, analogous to the organizational role
  of `nest-cli.json`.

Official Nest references:

- <https://docs.nestjs.com/cli/overview>
- <https://docs.nestjs.com/cli/usages>
- <https://docs.nestjs.com/cli/workspaces>
- <https://docs.nestjs.com/first-steps>
- <https://docs.nestjs.com/modules>
- <https://docs.nestjs.com/controllers>

## Commands

```text
aponia new <name> [options]
aponia n <name> [options]
aponia generate <schematic> <name> [options]
aponia g <schematic> <name> [options]
aponia build [options]
aponia help
aponia version
```

Project names must use lowercase kebab-case:

```text
users-api
commerce-service
internal-tools
```

The generator refuses to overwrite an existing target directory.
Generated manifests pin Aponia runtime packages to the CLI version so decorators
and runtime packages cannot drift to different releases.

## Generate

The published `@aponiajs/cli` package supports every built-in schematic listed
by the Nest CLI command reference:

| Schematic     | Alias | Output                |
| ------------- | ----- | --------------------- |
| `app`         | —     | workspace application |
| `library`     | `lib` | workspace library     |
| `class`       | `cl`  | plain class           |
| `controller`  | `co`  | HTTP controller       |
| `decorator`   | `d`   | custom decorator      |
| `filter`      | `f`   | exception filter      |
| `gateway`     | `ga`  | WebSocket gateway     |
| `guard`       | `gu`  | request guard         |
| `interface`   | `itf` | TypeScript interface  |
| `interceptor` | `itc` | request interceptor   |
| `middleware`  | `mi`  | middleware            |
| `module`      | `mo`  | Aponia module         |
| `pipe`        | `pi`  | transformation pipe   |
| `provider`    | `pr`  | injectable provider   |
| `resolver`    | `r`   | GraphQL resolver      |
| `resource`    | `res` | complete resource     |
| `service`     | `s`   | injectable service    |

`router`, `routers`, and `route` are convenience aliases for `controller`, since
Aponia controllers own the Elysia route declarations.

```bash
aponia g module users
aponia g controller users
aponia g service users
aponia g router health --no-spec
aponia g resource users --type rest
```

Component options follow Nest conventions:

```text
--dry-run, -d
--flat / --no-flat
--spec / --no-spec
--skip-import
--module <name>
--project, -p <name>
--path <path>
```

The flags that take no value — `--dry-run`, `--skip-install`, `--flat`,
`--spec`, `--skip-import`, `--crud`, and the short aliases `-d` and `-s` — reject
an attached value instead of ignoring it, so `--dry-run=true` exits non-zero and
writes nothing. Negate one with `--no-flat`, `--no-spec`, or `--no-crud`. A flag
does not consume the argument after it, so `aponia new --dry-run my-api` reads
`my-api` as the project name.

Resources additionally support `--crud` / `--no-crud` and these transports:
`rest`, `graphql-code-first`, `graphql-schema-first`, `microservice`, and `ws`.
REST resources generate a controller; GraphQL resources generate a resolver;
WebSocket resources generate a provider-registered gateway. A CRUD WebSocket
resource maps `<resource>.create`, `.findAll`, `.findOne`, `.update`, and
`.remove` through `@SubscribeMessage()` and injects event data with
`@MessageBody()`. A standalone gateway is immediately mountable:

```ts
import { WebSocketGateway } from "@aponiajs/common";

@WebSocketGateway("/events")
export class EventsGateway {}
```

See the [WebSocket gateway guide](./websockets.md) for the event envelope and
runtime behavior.

A REST CRUD resource also generates `<name>.model.ts`, which owns the route
validation model for that resource:

```text
src/users/
|-- entities/
|   `-- user.entity.ts
|-- users.controller.ts
|-- users.module.ts
|-- users.model.ts
`-- users.service.ts
```

`users.model.ts` keeps each raw validator beside one exported validation-model
class. The same-named interfaces derive their fields from those validators, so
each field is declared once and controller methods use the classes directly:

```ts
import { Validation, type InferValidatorOutput } from "@aponiajs/common";
import { t } from "elysia";

const createUserSchema = t.Object({
  name: t.String({ minLength: 1 }),
});

const updateUserSchema = t.Partial(createUserSchema);
const userParamsSchema = t.Object({ id: t.String() });

@Validation(createUserSchema)
export class CreateUser {}
export interface CreateUser extends InferValidatorOutput<typeof createUserSchema> {}

@Validation(updateUserSchema)
export class UpdateUser {}
export interface UpdateUser extends InferValidatorOutput<typeof updateUserSchema> {}

@Validation(userParamsSchema)
export class UserParams {}
export interface UserParams extends InferValidatorOutput<typeof userParamsSchema> {}
```

The generated controller consumes those classes directly:

```ts
@Post("/", { body: CreateUser })
create(@Body() input: CreateUser) {
  return this.usersService.create(input);
}

@Patch(":id", { params: UserParams, body: UpdateUser })
update(@Param() params: UserParams, @Body() input: UpdateUser) {
  return this.usersService.update(params.id, input);
}

@Delete(":id", { params: UserParams })
remove(@Param() params: UserParams) {
  return this.usersService.remove(params.id);
}
```

Schemas use Elysia's `t` builder, which ships with the platform peer dependency.
Swap in any [Standard Schema](https://standardschema.dev) validator — Zod,
ArkType, Valibot — by editing that one file. Each class owns exactly one complete
validator; create, update, and path-parameter contracts are intentionally
separate. Non-REST transports continue to generate ordinary DTO files.

CLI flags override project-specific `generateOptions`, which override global
`generateOptions` in `aponia.json`. Both `spec` and `flat` defaults are
supported. `spec` may be a boolean or a map keyed by schematic name.

Controllers are added to `controllers`, services and providers to `providers`,
and modules and resources to `imports`. Use `--skip-import` to create files
without changing a module, or `--module <name>` to select the declaring module.
Registration only searches the configured source root, so `--path` pointing
outside it leaves no module to update; that run fails with a non-zero exit code
and writes nothing. The update is computed before any file is written, and the
generator refuses to overwrite an existing file.

## Create an application

```bash
aponia new my-api
aponia new my-api --skip-install
aponia new my-api --dry-run
```

## Generated project

```text
my-api/
|-- .env.example
|-- .gitignore
|-- AGENTS.md
|-- aponia.json
|-- llms.txt
|-- package.json
|-- README.md
|-- scripts/
|   |-- build.ts
|   `-- inspect.ts
|-- tsconfig.json
|-- vite.config.ts
|-- src/
|   |-- app.controller.spec.ts
|   |-- app.controller.ts
|   |-- app.module.ts
|   |-- app.service.ts
|   |-- descriptors.generated.ts
|   |-- invokers.generated.ts
|   |-- logger.ts
|   `-- main.ts
`-- test/
    `-- app.e2e-spec.ts
```

The generated runtime flow is:

```text
main.ts
  -> AponiaFactory.create(AppModule, {
       descriptors: moduleDescriptorArtifact,
       invokers: controllerInvokerArtifact,
       logger: appLogger,
     })
  -> AppModule
  -> AppController
  -> AppService
```

`main.ts` owns only bootstrap configuration, the two generated artifacts, the
logger it holds, and `listen`. Decorated controllers own routes. Services own
application behavior. Generated application code does not import Elysia or
low-level runtime descriptors.

`src/logger.ts` holds the application's logger, and `src/main.ts` hands that one
object to `AponiaFactory.create`, so every bootstrap line is written through the
logger the application also holds.

A [devtools](./devtools.md) registration is added the same way — the import is
`DevtoolsModule.register({ enabled, logger: appLogger })`, declared in
`src/app.module.ts` and handed the same logger — but the starter does not make
it. A registration is a dynamic module, and `aponia build` reports a root module
that imports one as `DECLINED`, because the committed
`descriptors.generated.ts` is what lets a fresh checkout boot from the declared
graph and a run-time registration cannot be lowered into it. The trade-off is
the application's to make; the [devtools guide](./devtools.md) states it.

The starter ships both generated modules, so a freshly generated application
serves through generated route invokers and boots from the declared module graph
without a build having run. `bun run build` refreshes them instead of creating
them.

This is standard mode and intentionally matches the flat starter structure
created by `nest new`. Generated resources belong directly under
`src/<resource>` and are imported by `AppModule`; the CLI does not create an
artificial `src/modules/app` directory.

## Build

```bash
aponia build            # write the generated modules
aponia build --dry-run  # report the files without writing them
```

`aponia build` reads every source file under the configured source root and
writes up to two modules.

### Route invokers

`<sourceRoot>/invokers.generated.ts` holds the route invokers the runtime would
otherwise build at startup, rewritten as literal source, so the application no
longer compiles them from the handler's own text or calls `new Function` to do
it.

Pass it to the factory from your entrypoint:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { controllerInvokerArtifact } from "./invokers.generated.ts";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule, {
  invokers: controllerInvokerArtifact,
});
```

The generated file also records the AponiaJS and Elysia versions it was built
against. The runtime refuses an artifact from another framework release and
compiles every route from decorator metadata instead, so a file that was not
regenerated after an upgrade costs a slower cold start rather than a wrong
binding. The startup log names both versions when that happens.

A handler the analysis cannot prove stays on the runtime's own compile path, so
the application works whether or not every handler was generated and whether or
not the file exists. Nothing is required: omitting the option is still the
default, and the runtime behaves exactly as before.

### Module descriptors

`<sourceRoot>/descriptors.generated.ts` holds the application's module graph as
data — `defineModule` calls with declared controllers and providers — so the
application can boot without lowering decorated classes at all. It is written
only when at least one `@Module()` could be read, so a project whose modules are
all built at run time still gets its invoker module.

Pass it to the factory from your entrypoint, which goes on naming the root module
class:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { moduleDescriptorArtifact } from "./descriptors.generated.ts";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule, {
  descriptors: moduleDescriptorArtifact,
});
```

The generated module exports `moduleDescriptorArtifact`: the descriptors keyed by
module class name, beside the AponiaJS and Elysia versions the file was built
against. Bootstrap looks up the name of the module you passed. When the artifact
holds a declaration for it, that declared graph serves the application, and the
startup log says so under `RoutesResolver`, so a route that behaves unexpectedly
can be traced to the graph that answered for it without reading the generated
file:

```text
[Aponia] 4210 - 07/25/2026, 10:30:00 AM     LOG [RoutesResolver] Booting AppModule from the generated module descriptors, so the declared graph serves this application. +0ms
```

Otherwise the artifact is refused whole and the root module you named is lowered
from its decorators, with the same context reporting why. A refusal is not an
error: the fallback is the bootstrap the application would have run without the
option at all, so a stale or hand-edited file costs a cold start rather than a
boot that cannot start. That is what makes the file an optimization an
application can ship — and what makes a descriptor left behind by a module
rename harmless, since the renamed root has no entry and the decorated graph
answers instead.

Because the artifact is substituted as a whole, its fallback is per application
rather than per module. A module the build declined is missing from it, and a
module that imports one the build declined is left out with it, so an application
whose root is reachable from a declined module boots from its decorators
throughout. Everything it would have booted from is still there: the decorators
remain the authoring surface, and the generated file changes which graph is
lowered, never which declarations exist.

Neither of the two decorator reads a generated module used to leave behind
happens on a path the build generated:

- A gateway is declared, not discovered. `@WebSocketGateway()` and
  `@SubscribeMessage()` are read at build time and emitted as a
  `defineElysiaWebSocketGateway(...)` provider carrying the path, the handlers,
  and the server properties as data, so bootstrap mounts the same gateway from
  that plan instead of reflecting on the class.
- A route's schema slot states the validator, not the model class. A
  `@Validation()` model is read at build time and its validator expression is
  written into the generated route, so bootstrap hands Elysia that validator
  directly and never resolves a model class while a route mounts. A model whose
  validator reads a module-private binding of its own file is written out with
  that binding folded in, because no other file can name it. Two model classes
  that share a name are the exception: the build cannot tell which one a slot
  meant, so it copies the class name and that route keeps the run-time read.

The decorators remain the authoring surface, and the paths that still read their
metadata are the ones the build did not touch: a module the build declined, and
every application that does not hand the artifact over.

Anything the build cannot read is reported rather than guessed at. Each decline
prints its own line, which is not a change line:

```text
CREATE src/invokers.generated.ts
DECLINED module UsersModule: @Module in /app/src/users/users.module.ts must declare "providers" as an array literal to be read statically.
```

A declined module is left out of the artifact whole; a declined route also sinks
the module that declares it, because a controller is declared whole and emitting
it without a route would leave the application answering a 404 where it used to
answer with the handler. Fix what the line names and build again.

The command only reads source, so it never starts the application, never
connects to anything, and never runs provider factories. Run it again whenever a
controller or a module changes: a file that is not current still boots the
application, from the decorators it was lowered from. It is separate from
`bun run build`, which bundles the application for deployment.

### Generating during a bundle

Because the two are separate, nothing forces an application to rebuild after a
controller changes, and an entrypoint that imports `invokers.generated.ts` only
bundles _correctly_ while that file is current. Register the build plugin in
whatever calls `Bun.build` to move the generation into the bundle itself:

```ts
// scripts/build.ts
import { aponiaBuildPlugin } from "@aponiajs/cli";

const result = await Bun.build({
  entrypoints: ["./src/main.ts"],
  outdir: "./dist",
  target: "bun",
  plugins: [aponiaBuildPlugin()],
});
if (!result.success) process.exit(1);
```

```bash
bun run scripts/build.ts
```

The plugin runs both generators with the same discovery the command uses, so it
finds the project through `aponia.json` the same way. Its options are passed
straight through:

| Option    | Meaning                                                             |
| --------- | ------------------------------------------------------------------- |
| `cwd`     | Directory to resolve the project from. Defaults to `process.cwd()`. |
| `project` | A named project from `aponia.json`, for a multi-project repository. |

Generation runs in the plugin's `onStart` hook, which Bun awaits before it
resolves the first import. That ordering is the whole point: the artifacts have
to exist before the bundler looks for the module that imports them. `bun build`
on the command line accepts no plugin flag, so registration is a script of your
own, as above.

The plugin prints the same `CREATE`/`UPDATE`/`DECLINED` lines the command prints,
and a generation failure fails the build: the generator's own error rejects it,
naming the declaration that has to change, rather than the bundle quietly
carrying the previous release's artifact. It writes nothing unless generation
completes, so the file on disk is untouched when that happens.

Registering it is opt-in for an application you already have. A project created
by `aponia new` starts with it registered: its `bun run build` runs
`scripts/build.ts`, which is the script above.

The starter commits both generated modules and its `src/main.ts` imports
`controllerInvokerArtifact` and `moduleDescriptorArtifact` and passes both to
`AponiaFactory.create`, so a freshly generated application serves through
generated route invokers from its first `bun run dev`, `bun start`, or
`bun test` — no build required. Each build refreshes them in place and reports
`UPDATE` rather than `CREATE`.

Both modules are laid out by a formatter that `@aponiajs/cli` calls rather than
imitates, so they are ordinary application source: your `vp check` reads them,
lint and format rules apply to them, and they belong in version control. If your
project has installed `vite-plus`, its copy of `oxfmt` formats the modules, which
is what makes the file a build writes the file your check accepts. If it has not,
the CLI's own `oxfmt` does, declared at an exact version so that the same sources
always produce the same bytes. A checkout where neither can be loaded is not an
error: the modules are still generated, in the layout the emitter wrote them.

A build that does not register the plugin behaves exactly as before, and
`aponia build` remains the way to generate without bundling.

The committed modules go stale when a controller or a module changes, and a
stale one is refused by the runtime rather than used: each records the framework
release it was built against, and an artifact from another release — or one that
holds no declaration for the module the application names — costs a slower cold
start, never a wrong route or a graph the application no longer declares, until
the next build rewrites it.

## Safety behavior

- Dry-run performs template discovery and name validation without writing.
- Existing target directories are never merged or overwritten.
- Template output is deterministic and sorted.
- Process arguments are passed to `Bun.spawn` as an array.
- Installation uses the Bun executable and inherits terminal streams.
- Installation failure returns a nonzero CLI result and removes the incomplete
  generated directory.

See the [published package catalog](./packages.md) for all AponiaJS npm
packages.
