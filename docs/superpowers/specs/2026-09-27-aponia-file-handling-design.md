# AponiaJS file handling — uploads, downloads, and static assets

Status: design.

## Why this document

The maintainer's word for this work was "file", and the reading that leads is
the Nest one: **uploads**. It leads because it is the surface a reader searches
for and finds nothing, and because the first thing that reader tries does not
work. The document therefore takes uploads first, then the download name, then
static assets, in that order.

The capability is not missing; it is **ungoverned**. A route whose body schema is
`t.Object({ file: t.File() })` already answers `200` and the handler receives a
real `File` instance — measured against this repository before this document was
written, in the probe recorded under "What the framework has today". What is
missing is that no user-facing document says so. `rg` for `upload`, `multipart`,
`t.File`, `t.Files`, or `t.Form` over `docs/*.md`, `docs/learn/*.md`,
`packages/common/src`, and `packages/platform-elysia/src` matches nothing, and
`examples/README.md` lists no file topic. An application author cannot discover a
capability the framework already has, and the shape they reach for first is the
one shape that answers `422`.

Two smaller gaps sit beside it. A handler that returns a `File` or a
`Bun.file(...)` streams with a detected content type, but `content-disposition`
is `null`, so a download cannot be named. And static assets have no documented
path at all, while the two paths that exist — the official Elysia plugin and
Bun's native directory route — are not equivalent, and the difference is one an
application has to know before it chooses.

This document is written against the installed dependencies, not against release
notes. Elysia is `1.4.30` (`node_modules/elysia/package.json`), and the Bun
declarations this repository compiles against are `bun-types@1.4.2`
(`node_modules/@types/bun` resolves to it). Every claim about either is cited to
the file and line it was read from.

## What the framework has today

Each fact below is either a source citation or the output of a probe run inside
this repository. The probes built an application with `AponiaFactory.create` and
called `application.handle(new Request(...))`, which is the platform's own test
discipline; the directory-route probe listened on a real port because a native
`Bun.serve` route is only composed when the server starts.

### The request side: multipart already arrives as a `File`

| Declaration                            | Result                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `body: t.Object({ file: t.File() })`   | `200`; `@Body()` is `{ file }` and `file instanceof File` is true               |
| `@Body("file")` over that same schema  | `200`; the parameter is the `File` directly                                     |
| `body: t.Object({ files: t.Files() })` | `200`; the body is `{ files: File[] }` with one element                         |
| `body: t.Form({ file: t.File() })`     | `200`; the body is `{ file }` and `file instanceof File` is true                |
| `body: t.File()`                       | **`422`**, message `Expected kind 'File'`, `expected` and `found` both `"File"` |

The `422` on `body: t.File()` is the boundary this document exists to write
down. Elysia's `t.File()` is a validator for a value that is _already_ a `File`,
and as a whole-body schema it refuses it. The working shapes all name the file
inside something — an object, or `t.Form`. This is the first thing a reader
tries, so it is the first thing the documentation must show failing.

The validator builder is Elysia's own: `t.File`, `t.Files`, and `t.Form` are
declared at `node_modules/elysia/dist/type-system/index.d.ts:28`, `:29`, and
`:38`, and their types at `node_modules/elysia/dist/type-system/types.d.ts:44`,
`:45`, and `:56`. `t.File` accepts `FileOptions` — `type`, `minSize`, and
`maxSize` (`types.d.ts:10-24`) — and `t.Files` accepts `FilesOptions`, which adds
`minItems`/`maxItems` (`types.d.ts:25-28`). That is where a size limit or a
content-type constraint is declared, not on any Aponia surface.

`@Body()` and `@Body("property")` are `packages/common/src/routing/route-parameters.ts`'s
`Body` decorator; the property form is the existing "one property" behavior, so
selecting a single uploaded file needs no new decorator. The body slot itself is
one of `routeSchemaSlots` (`packages/common/src/routing/route-schema.ts:5-12`),
which has no `file` member and does not need one: a file is a body.

### The response side: a `File` streams, but carries no name

| Return value                                                       | Response                                                                                                                           |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Bun.file("/tmp/.../report.txt")`                                  | `200`, `content-type: text/plain;charset=utf-8`, `content-disposition: null`, `accept-ranges: bytes`, `content-range: bytes 0-7/8` |
| `file("/tmp/.../report.txt")` (Elysia's named `file` export)       | `200`, same content type and `content-disposition: null`                                                                           |
| `Bun.file(...)` with `res.headers["content-disposition"]` assigned | `200`, the header appears on the response                                                                                          |
| `res.headers["content-disposition"]` with a raw non-ASCII value    | **throws** `TypeError: Header 'content-disposition' has invalid value: ...` from inside Elysia; the request answers nothing        |

The last row is the load-bearing one. `Headers` rejects a value outside the
byte range HTTP allows. The returned `File` reaches the Bun adapter's
`handleFile`, whose plain-object branch builds the response with
`Object.assign(defaultHeader, set.headers)` and hands `set.headers` to the
`Response` constructor (`node_modules/elysia/dist/adapter/utils.js:88-90`); the
`Headers` built inside that `Response` is what throws. A handler that writes a
Thai filename straight into `content-disposition` does not "fail to name the
file" — the `TypeError` escapes `application.handle` uncaught, and the request
answers nothing: no response and no Problem Details. So naming a download is not
cosmetic; without an encoded value it is a runtime failure on the exact case a
non-English application hits first.

Elysia's named `file` export returns an `ElysiaFile` whose `value` is
`Bun.file(path)` on Bun (`node_modules/elysia/dist/universal/file.js:106-109`),
declared at `node_modules/elysia/dist/universal/file.d.ts:80-87` and re-exported
at `node_modules/elysia/dist/index.d.ts:2195`. The Bun adapter recognizes
`ElysiaFile`, `File`, and `Blob` by constructor name and sends all three through
`handleFile` (`node_modules/elysia/dist/adapter/bun/handler.js:26-40`), which
sets `accept-ranges` and `content-range` and never sets `content-disposition`
(`node_modules/elysia/dist/adapter/utils.js:31`, and the `defaultHeader` it
builds at `:74-77`). That is the whole reason a name is missing.

The response settings a handler writes are `RouteResponseSettings`
(`packages/common/src/routing/route-schema.types.ts:57-61`): `status` and
`headers`, with no `redirect` field. The absence is deliberate and is asserted:
`packages/common/tests/contracts.test.ts:25-33` pins `"redirect" extends keyof
RouteResponseSettings ? true : false` to `false`, and the comment above it states
why — the platform ignores an assigned redirect and a handler returns the
platform's own inline `redirect(url)` helper instead. `@Set()` and `@Res()` are
the same decorator (`packages/common/src/routing/route-parameters.ts`, `Res = Set`),
and the compiled invoker passes `context.set` to the handler
(`packages/platform-elysia/src/routing/route-compiler.ts:502-504`). Nothing
intercepts the headers a handler assigns; the probe saw them on the response.

### What the platform narrows

The platform constructs its root Elysia with exactly two compilation options:

```ts
const baseApplication = new Elysia({
  ...options.elysia,
  name: compiledRootModule.id,
});
```

`packages/platform-elysia/src/application/application-bootstrap.ts:89-92`, where
`options.elysia` is `ElysiaCompilationOptions`, defined as
`Pick<ElysiaConfig<undefined>, "aot" | "precompile">`
(`packages/platform-elysia/src/application/application.types.ts:11-12`, declared
as the option at `:27`). So the `elysia` option deliberately does **not** reach
Elysia's `serve` config. `configureNative` receives the constructed instance and
must return it (`application-bootstrap.ts:93-100`), and `AponiaElysiaApplication`
exposes `getNativeApplication()` and `listen(port)` — a port, no options
(`packages/platform-elysia/src/application/aponia-elysia-application.ts:14-16`,
`:22-34`).

The application also has one supported way to mount a native plugin:
`AponiaApplicationOptions.plugins`
(`application.types.ts:92`), which mounts each entry on the root application
before any controller, and `defineElysiaPlugin`/`ElysiaPluginModule.register`
for a module-declared plugin.

### Bun's native directory route

Bun `1.4.2` supports a directory route as a serve option. The shape is
`DirectoryRouteOptions { dir: string; statCache?: boolean }`
(`node_modules/.bun/bun-types@1.4.2/node_modules/bun-types/serve.d.ts:624-633`),
admitted as a route value at `:635`, and its documented behavior — the path
**must** end in `/*`, non-canonical paths answer `404`, a directory without a
trailing slash is `301`-redirected, `index.html` is served for a directory,
missing files are `404` (`serve.d.ts:594-613`) — is Bun's, not Elysia's.

Elysia merges such routes into the server it starts: its Bun adapter reads
`app.config.serve?.routes` into the `routes` it passes to `Bun.serve`
(`node_modules/elysia/dist/adapter/bun/index.js:158-166`), and `config` is a
public field of the instance (`node_modules/elysia/dist/index.d.ts:54`), with
`ElysiaConfig.serve?: Partial<Serve>` at `node_modules/elysia/dist/types.d.ts:73`.
The probe mounted one through `configureNative`:

```ts
configureNative: (native) => {
  native.config.serve = { routes: { "/assets/*": { dir: "./public" } } };
  return native;
},
```

and measured `200` with `content-type: text/css;charset=utf-8` for a real file, a
bare `404` with `content-type: null` for a missing one, against `500`
`application/problem+json` for a framework route that throws — the native route
is outside Elysia's lifecycle entirely, so the platform's default Problem Details
mapping, which is compiled into each route the platform itself mounts, never
sees it. This is the first honest statement the static recipe owes a reader.

One correction to record, because it changes the recipe: passing `routes` through
`listen` does **not** work. The adapter spreads `...options` and then sets
`routes` explicitly to the merge of the application's own routes and
`app.config.serve.routes` (`adapter/bun/index.js:158-173`), so an
`options.routes` is overwritten. The route must be set on `config.serve` before
`listen` runs, and `configureNative` is the supported place to do it.

### What the workspace does not have

Neither `@elysia/static` nor `@elysiajs/static` is installed: there is no
top-level `node_modules/@elysia` or `node_modules/@elysiajs` directory at all.
Both do exist on npm — the registry reports `@elysia/static` latest `1.4.11` and
`@elysiajs/static` latest `1.4.10`, the `@elysiajs` name being the older alias —
so a recipe can name them, but nothing in this workspace can exercise one without
adding it.

`@elysia/eden` is installed, but only as a dev dependency of
`packages/platform-elysia` (`packages/platform-elysia/package.json:41`), under
`packages/platform-elysia/node_modules/@elysia/eden`. No workspace-wide `@elysia`
scope is installed. The distinction is minor for the decision — no static plugin
is installed either way — but it is recorded rather than smoothed over, because
"add an `@elysia` dependency" already has precedent here.

## What changes

| Surface  | Ships as                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------- |
| Upload   | Documentation and one example. No runtime code: the capability works and nothing needs building.  |
| Download | One small helper whose job is the `content-disposition` value, wrapped around the existing seams. |
| Static   | A documented recipe with two options and no new dependency in any package.                        |

### Upload — documentation and an example, because there is nothing to build

The measured capability is complete: Elysia parses the multipart body, `t.File()`
validates it, `@Body()` and `@Body("file")` hand it to the handler, and the file
slot is the ordinary body slot with no framework code in the path. Adding a
runtime API here would be a second parser for a body the substrate already
parses — the opposite of "reuse before build". What uploads lack is a place to
read about them, so the change is a reference document, a learn chapter, and an
example that runs the shapes above, the `422` boundary included.

The documentation states, in this order: the working object form; the `422` and
why `t.File()` alone is not it; `t.Files()` for one-or-more; `t.Form()` for a
mixed form; `@Body("file")` for a single file; the `FileOptions` limits; and the
fact that a `File` is an ordinary body value with no Aponia type of its own.

### Download — one helper, and only the name

The helper's entire responsibility is the `content-disposition` value. It wraps
Elysia's `file(...)` so the response is still streamed by the platform's own path,
and it writes into the `RouteResponseSettings.headers` a handler already receives.
Its contract:

```ts
// Package: @aponiajs/platform-elysia
// (not @aponiajs/common — see "What this does not change")
function downloadFile(
  settings: RouteResponseSettings,
  path: string,
  filename: string,
  options?: { readonly disposition?: "attachment" | "inline" },
): ElysiaFile;
```

It writes `settings.headers["content-disposition"]` and returns
`file(path)`. It constructs no `Response`, opens no stream, and reads no file —
the returned `ElysiaFile` is what the platform streams, as the probe showed it
already does.

The value it writes follows RFC 6266, with the extended parameter per RFC 8187
(which obsoletes RFC 5987):

- The disposition type is `attachment` unless `disposition: "inline"` is asked
  for, so the default names a download and the escape hatch names a render.
- `filename*` carries the name as an ext-value: the literal `UTF-8''`, then the
  name's UTF-8 bytes percent-encoded, keeping RFC 8187's `attr-char` set
  (`ALPHA / DIGIT / "!" / "#" / "$" / "&" / "+" / "-" / "." / "^" / "_" / "`" /
  "|" / "~"`) unencoded and encoding everything else, a space as `%20` included.
- `filename` carries an ASCII fallback for clients that do not read `filename*`,
  quoted, with `"` and `\` backslash-escaped and every non-ASCII code unit
  replaced, so the fallback can never itself contain the value Bun rejects.
- A name containing `CR`, `LF`, or `NUL`, or a path separator, is refused before
  the header is written, with a `TypeError`: a value the application hands a
  helper while it runs is a caller mistake, the runtime half of the batch's
  convention for input a surface cannot use
  (`2026-09-27-aponia-utility-batch-delivery-design.md` §7). The probe proved
  Bun's own `Headers` rejects CR/LF by throwing, so the helper refusing first
  gives a named failure instead of an engine message from inside the response
  construction.

A pure-ASCII name is the same function's ordinary case: `filename*` is still
emitted (it is valid and unambiguous for every name), and the fallback equals the
name. Emitting both parameters for every name is what RFC 6266 §4.3 recommends
and it removes a branch — the value is one construction, not two.

### Static — a recipe, two options, one honest trade-off

No framework package gains a static server and no new dependency is added. The
recipe documents two paths and says which applies when:

| Path                           | Needs                                                  | Inside Elysia's lifecycle | Cost                                                                       |
| ------------------------------ | ------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------- |
| `@elysia/static` via `plugins` | `bun add @elysia/static` in the application            | Yes                       | A dependency the application owns; the framework gains nothing             |
| Bun native directory route     | `configureNative` setting `native.config.serve.routes` | **No**                    | The route leaves Elysia entirely, and the platform's error mapping with it |

The trade-off is stated, not resolved. The plugin keeps the request inside
Elysia, so Elysia's hooks and error path still apply to it; the native route is
Bun's and answers `404` — measured — with no `content-type` and no Problem
Details, because the platform's default mapping is compiled only into routes the
platform mounts. The native route is the one with modern hardening built in
(root-confined opens, canonical-path rejection, `Last-Modified`/`ETag`,
single-range requests; `serve.d.ts:594-613`), and it costs no dependency. The
recipe's order is: reach for the plugin when the asset route must behave like a
route; reach for the native route when it must be a fast file server and the
application accepts that it answers the way Bun answers.

## The contract this settles

**Uploads are a body, not a new parameter kind.** A file arrives through the
existing `body` slot and the existing `@Body()` decorator. There is no new
`RouteParameterKind`, no new schema slot, and no Aponia file type; the value the
handler receives is the platform's own `File`. This is the whole contract, and it
is the reason the upload change is documentation rather than code.

**A download is a named response, and the name is the only new thing.** A handler
already streams a file; the helper adds one header value and nothing else. It
must not construct a `Response`, must not become a second streaming path, and
must not add a field to `RouteResponseSettings` — the header record is the
existing seam and stays the seam. The helper lives in `@aponiajs/platform-elysia`
because it wraps Elysia's `file` and because `@aponiajs/common` may not import
Elysia; the type it writes into, `RouteResponseSettings`, is already `common`'s
and is imported, not redefined.

**Static assets are the application's decision, and the framework states the
price of each.** No framework package serves files. The recipe names both paths,
names the lifecycle difference, and names the native route's error behavior as a
consequence the application chooses, not a defect to work around.

## Options considered and rejected

**A framework multipart parser or upload middleware.** Rejected: Elysia already
parses multipart into a `File`, and the measured path needs no framework code.
A second parser is a second body-reading path, duplicates a dependency's
behavior, and breaks the route contract the compiled invoker depends on. The
repository's rule is explicit — write custom code only for Aponia-specific domain
behavior when no maintained package exists — and here the behavior exists in the
substrate.

**A `content-disposition` field on `RouteResponseSettings`.** Rejected: the type
is the platform-neutral response contract, and a header-specific field on it
would teach every handler a download concept none of them declared. The `headers`
record already carries the value; the helper is the one place that knows how to
build it. This is also what keeps `common` out of it: `common` does not know what
`content-disposition` is, and this change does not teach it.

**The helper returning its own `Response` with a body stream.** Rejected: the
platform and Elysia already stream a returned `File`/`ElysiaFile` with a detected
content type, `accept-ranges`, and range support. Rebuilding that is the second
streaming path the download decision rules out, and it would diverge from the
platform's own response path the moment either changed.

**Adding `@elysia/static` as a framework dependency.** Rejected: a static file
server is general-purpose behavior the application can name for itself, and the
framework's minimalism is a stated property. The plugin belongs in the
application's `plugins` option, where the application owns the dependency and its
upgrade.

**Building a framework static-file implementation.** Rejected: it is exactly the
general-purpose behavior the reuse rule forbids, Bun's native route already does
it with hardening this framework would not reproduce, and the plugin covers the
lifecycle-integrated case. The framework documents the choice rather than making
it.

**Adding a `file` route schema slot.** Rejected: a file is a body, the `body`
slot already carries one, and a second slot would widen `routeSchemaSlots`,
`RouteContext`, and the platform hook builder for a value they already describe.

## What this does not change

- **`RouteResponseSettings` gains nothing.** No `redirect` field (the existing
  decision stands; `contracts.test.ts:25-33`), no `content-disposition` field,
  no new header name in `common`. The interface is untouched.
- **`routeSchemaSlots` is unchanged.** No `file` slot; uploads ride the body slot.
- **`RouteParameterKind` is unchanged.** `@Body("file")` is the existing
  property form of the existing decorator.
- **No package gains a runtime dependency.** The download helper uses Elysia,
  which `platform-elysia` already has as a peer; the static recipe adds a
  dependency to the application that chooses the plugin, never to a package here.
- **The response path stays Elysia's.** The platform does not gain a response
  mapper, a stream builder, or a file reader. The helper returns an `ElysiaFile`
  the platform already knows how to serve.
- **`AponiaApplicationOptions.elysia` stays `aot | precompile`.** The static
  recipe uses `configureNative`, the existing native escape hatch, not a widened
  option.

## Delivery order

Three pieces, each shippable alone, ordered so a regression is attributable.

1. **Upload documentation and the example.** Self-contained: no runtime code
   changes, so nothing can regress. It lands first because it closes the largest
   gap and because the example's upload cases are the fixture the download case
   is added to next.
2. **The download helper, with its tests and the example's download cases.** It
   touches one package and adds public API, so it ships with its tests, the
   `packages/platform-elysia` README, and `docs/files.md`. The non-ASCII filename
   case is the one that fails without it and the one that proves it.
3. **The static recipe.** Last, because it changes no code and depends on the
   reference document the download change introduces. Its native-route half is
   exercised in the example; its plugin half is prose with a pointer, because
   neither plugin is installed and this change does not install one.

The learn chapter and the reference document land with step 1 for uploads and are
extended by steps 2 and 3 rather than introduced by them, because a chapter that
appears in step 3 and retroactively covers step 1 is harder to review than one
grown in place.

## What remains, deliberately

- **No Aponia upload API.** The documentation teaches Elysia's, because that is
  the API that exists and the framework does not wrap it. A reader who wants a
  framework-owned upload type does not get one here.
- **The helper names a download and nothing else.** Range requests, resumption,
  `ETag`/`Last-Modified`, and content-type detection are Elysia's and Bun's and
  are not re-implemented. A download that needs conditional requests uses what
  the substrate already returns.
- **Upload size and type limits are Elysia's `FileOptions`.** The framework does
  not add a limit of its own, and the documentation points at `t.File({ maxSize:
"3m" })` rather than inventing one.
- **The plugin half of the static recipe is untested here.** `@elysia/static` is
  not installed and this change does not install it, so its behavior is described
  from the registry listing and Elysia's lifecycle, not from a probe in this
  repository. The native half is measured, and the document says which is which.
- **A non-ASCII name is percent-encoded, not transliterated.** The ASCII fallback
  replaces non-ASCII code units rather than translating them, because a
  transliteration has to be chosen per script and this framework has no business
  choosing a Thai name's Latin spelling. The fallback is for old clients; the
  ext-value carries the real name.

## Testing

The lanes follow `RULES.md`'s ownership table.

- **Upload** — the example `examples/files` asserts through
  `application.handle(new Request(...))`: `t.Object({ file: t.File() })` answers
  `200` and `@Body()` is a `File`; `@Body("file")` yields the file directly;
  `t.Files()` yields an array; `t.Form()` yields the parsed form; and
  `body: t.File()` answers `422`. The `422` case is an assertion, not a note, so
  the boundary stays measured when the substrate moves.
- **Download** — focused Bun tests in `packages/platform-elysia/tests`, mirrored
  in `tests-vp` where the public type is involved: the helper writes an
  `attachment` value by default and an `inline` value on request; a non-ASCII
  filename produces an ASCII header value with a `filename*` ext-value that
  round-trips under percent-decoding, and the equivalent raw value is shown to
  reject the request, which is the regression the helper removes; an ASCII filename produces
  both parameters and the fallback equals the name; a name with `CR`/`LF`/`NUL`
  or a path separator is refused with a `TypeError`; and the returned value is
  what the platform streams, asserted end to end over `application.handle` with a
  real temporary file. The example asserts the download cases beside the upload
  ones.
- **Static** — the example asserts the native directory route: a real asset under
  the prefix answers `200` with the extension's content type, and a missing asset
  answers Bun's `404` rather than Problem Details, which pins the trade-off the
  recipe states. This is the case that fails if a future change routes the
  platform's error mapping into a native route. The plugin branch is not tested
  here and the document says so.
- **Guards** — the new documents are subject to the existing documentation
  guards; the learn chapter must be numbered contiguously, listed in
  `docs/learn/README.md`, and chained from its predecessor, which
  `scripts/learning-path.spec.ts` enforces.

Every case carries a mutation that makes it fail alone.

## What this document does not decide

**The helper's exported name and its exact options object.** The contract above
names the job and the arguments' shapes; whether it is `downloadFile`, `download`,
or something else, and whether the options are a positional string or an object,
is a naming decision for the plan, not a design one. It is named here so it is
not mistaken for an oversight.

**The exact replacement character in the ASCII fallback.** The rule — every
non-ASCII code unit is replaced so the fallback stays inside what Bun's `Headers`
accepts — is settled; whether the replacement is `_` or `?` is a detail the plan
picks. What is settled is that the fallback is ASCII and always present.

**A dedicated `@UploadedFile()`/`@UploadedFiles()` parameter kind.** Not
designed, and this is a YAGNI call rather than an omission. Such a decorator
would have to add members to the frozen public `RouteParameterKind` union
(`packages/common/src/routing/route-parameters.ts`'s `routeParameterKinds`), it
would need a platform-side binding compiled into every route that used it, and it
would buy nothing: `@Body("file")` already selects exactly the parsed `File` the
decorator would return, and `@Body()` already gives the object form. A union
member is a permanent widening of a public contract for a spelling that already
has one; if a real need appears that `@Body` cannot serve, it should be argued
then, on the failing case, not pre-emptively here.

**Where the reference document and the learn chapter sit.** The reference is
proposed as `docs/files.md` and the chapter as an appended `15 · Files`, because
files is a topic of its own and `examples/AGENTS.md` prescribes a new example
directory for one. The final filenames and the chapter text are the plan's, and
the learning-path guard requires the numbering and the index to move together.
