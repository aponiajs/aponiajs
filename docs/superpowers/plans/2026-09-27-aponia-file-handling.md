# File handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An application can read an uploaded file, answer with a named download, and
serve static assets, and every one of those three things is documented, exemplified,
and pinned by this repository's own tests.

**Architecture:** There is no upload runtime to build: Elysia parses multipart into a
`File`, the ordinary `body` slot carries it, and `@Body()` hands it over, so uploads
ship as a reference page, a learn chapter, and an example that measures the five
shapes. One small helper, `downloadFile` in `@aponiajs/platform-elysia`, writes the
single header a downloaded file cannot name itself with — RFC 6266 with the RFC 8187
extended parameter — and returns the value the platform already streams. Static
assets stay the application's decision: the recipe documents the plugin path and the
Bun native directory route, and the example exercises the native one through a real
socket, because a native route never reaches `application.handle`.

**Tech Stack:** TypeScript (strict, ESM), Bun test, Vite+ conformance, Elysia 1.4.30,
`t.File`/`t.Files`/`t.Form` from `elysia`.

**Spec:** `docs/superpowers/specs/2026-09-27-aponia-file-handling-design.md`

## Corrections the spec needs, settled before Task 1

Six claims in the spec are wrong, incomplete, or unusable as written. Each is
settled here with what was measured, because a task that argued from the text as
written would ship the defect.

**1. `t.File`'s limit options are not one story.** The spec says `FileOptions` —
"`type`, `minSize`, and `maxSize`" — "is where a size limit or a content-type
constraint is declared, not on any Aponia surface" (`:64-67`). Measured against
`elysia@1.4.30` in this workspace:

| Declaration                                                         | Sent                      | Answer                                |
| ------------------------------------------------------------------- | ------------------------- | ------------------------------------- |
| `t.File({ maxSize: "1k" })`, `{ minSize: "1k", maxSize: "2k" }`     | 512 bytes / 2 KiB / 4 KiB | `422` / `200` / `422`                 |
| `t.File({ type: "image/png" })`                                     | a real 70-byte PNG        | `200`                                 |
| `t.File({ type: "image/png" })`                                     | a real 28-byte text file  | `422` "has invalid file type"         |
| `t.File({ type: "text/plain" })`                                    | a real text file          | `422` "has invalid file type"         |
| `t.File({ extension: "image/png" })` (the option the runtime reads) | a text file               | `200` — not enforced through `t.File` |

Two consequences the document must carry and the spec does not. Size limits work
exactly as described, with no dependency. A `type` constraint is a **content** check:
it inspects the file's bytes, so a plain-text file whose part says `text/plain` is
refused anyway (`packages`-level detail: `node_modules/elysia/dist/type-system/utils.mjs`
`fileType()` throws `InvalidFileType` when detection returns nothing). The document
therefore states size limits as usable, and states `type` with that measured
consequence rather than calling it a content-type constraint. `extension` is not
documented: it is absent from the declared `FileOptions` and is not enforced through
`t.File`.

**2. The 422 an upload boundary produces is Elysia's validation answer, not Problem
Details.** The spec's Testing section asks for the `body: t.File()` case to be an
assertion (`:424-425`) without saying what the assertion sees. Measured: status `422`,
`content-type: application/json`, body
`{"type":"validation","on":"body","property":"root","message":"Expected kind 'File'","expected":"File","found":"File",…}`.
The default Problem Details mapping declines a status Elysia already decided, so this
is the answer an upload gets and the example asserts exactly that shape.

**3. A filename cannot be both refused as a path and escaped as a quote.** The spec
refuses "a path separator" (`:259-265`) and separately escapes `"` and `\` in the
ASCII fallback (`:256-257`). `\` is the Windows path separator, so it is refused, and
the escaping rule for it is unreachable. Task 3 deletes that clause: the fallback
escapes `"` alone. Both rules cannot be live at once, and a rule that can never run is
the kind of thing this repository has been removing.

**4. The static half cannot use the lane this repository tests everything else in.**
The spec calls the native route "measured" (`:161-175`) but not what that costs a test:
measured here, the route answers `404` with `content-type: null` through
`application.handle` — it composes only once the server starts — and a `dir` of
`./public` throws `ENOENT` when the process runs from the repository root, which is
where `bun run test:examples` runs it. The example therefore resolves its assets
directory from `import.meta.dir` and asserts this half by listening on an ephemeral
port and fetching, the way `examples/websockets` reserves one.

**5. The helper's name and options shape are this plan's, as the spec says
(`:450-461`).** The name is `downloadFile`, the options type is `DownloadFileOptions`,
and the ASCII fallback replaces each non-ASCII code unit with `_`.

**6. The fallback rule was narrower than the grammar the fallback has to satisfy.** The
spec replaces "every non-ASCII code unit" (`:256-257`) and refuses CR, LF, NUL, and a path
separator (`:259-265`). A control character outside those three satisfies both rules and
reaches the quoted string — `\u0001`, a tab, `\u007f` — and RFC 7230's `qdtext` has no room
for any of them, so the value goes to the wire outside the grammar it claims to follow.
Measured: Bun accepts such a value rather than refusing it, so nothing catches it but the
client. Task 3 replaces every code unit outside printable ASCII, which is one condition
instead of two, leaves the value valid for every input, and keeps the spec's refusals
exactly as they are.

One claim is dropped rather than corrected: the spec's Downloads section names `ETag` among
the things that "stay Elysia's" (`:399-402`), and Elysia's file path sets `accept-ranges`,
`content-range`, `content-length`, and content-type but no validator — grepping its
distribution finds `etag` only as a header name in type declarations. The sentence in
`docs/files.md` drops it.

## Global Constraints

- Every file, comment, and document is English. Before finishing a task:
  `rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .`
  The non-ASCII filename the download tests use is Greek (`Ω 2026.csv`), not Thai,
  so that scan stays a check for untranslated prose rather than a fixture list.
- **Branch from the specs branch, not `release/alpha`.** The plan argues from a spec
  that only `feature/utility-surface-designs` (`e1f9985`, `504b2a5`) carries, so the
  work branch is created from that tip. The batch delivery document expects one branch
  per document from `release/alpha`; this differs only by the spec commit the other
  branch already holds, and merging that branch first leaves this diff unchanged.
- **Do not push, and do not bump the version.** The version gate is a push-time step
  (`docs/releasing.md`); `bun run version:alpha` runs when this work is pushed. A push
  to a release branch publishes all six packages, so the bump belongs to the push, not
  to these commits.
- **The helper adds no response path.** It must not construct a `Response`, must not
  open a stream, must not read the file, and must not add a field to
  `RouteResponseSettings` — `packages/common/tests/contracts.test.ts:25-33` pins that
  interface, and the header record is the existing seam.
- **Nothing is added to `@aponiajs/common`.** No header name, no file type, no
  `@UploadedFile()` parameter kind, no schema slot. `RouteParameterKind` and
  `routeSchemaSlots` are unchanged, and `AponiaErrorCode` gains no member.
- **No new dependency and no new source directory.** `downloadFile` lives in
  `packages/platform-elysia/src/routing/`, an owner directory
  `scripts/source-layout.spec.ts` already lists, so that guard is untouched. Nothing is
  installed for the plugin half of the static recipe.
- **The example's port is 3080** and its directory is `examples/files`; the port list
  ends at 3070 and `scripts/toolchain-config.spec.ts` does not cover `examples/`, so
  `examples/files/tsconfig.json` must still declare `experimentalDecorators` and
  `emitDecoratorMetadata` — Bun reads the transpiler configuration from the working
  directory, and `bun run --cwd examples/files test` runs from there.
- **Registering the example is four prose edits and one lockfile.** The root
  `package.json` `example:files` script, the `examples/README.md` row, the
  `examples/AGENTS.md` name list, and `bun install` (which adds the workspace to
  `bun.lock`). No guard fails when one of them is missed.
- **Markdown tables are formatter-owned.** `bun run check` is `vp check`, and Oxfmt
  column-aligns the tables in `docs/AGENTS.md`, `docs/learn/README.md`,
  `examples/README.md`, and `packages/platform-elysia/README.md`. Edit by hand, then
  run `bun run check --fix`; a passing `bun test` does not prove the documents are
  formatter-clean.
- Gates before each task's commit: `bun run check` plus the lanes that task names.
  Whole-branch verification, after Task 4, runs `bun run check`,
  `bun run test:coverage`, `bun run test:vite-plus`, `bun run test:examples`,
  `bun run release:dry-run` (published package contents change), then `bun run build`
  followed by `bun run test:generated-app`. After any `bun run build`, delete the
  declarations it leaves beside sources before a test lane:
  `find packages -name '*.d.ts' -path '*/src/*' -delete`.
- Commit bodies explain why the change is right, in the style of the commits already
  on this branch, and end with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
- **No scope-list edit.** `README.md`'s and `AGENTS.md`'s implemented and
  not-implemented lists are moved by the batch delivery document, which names the
  configuration and logging-seam documents as the only two that move them; this
  document's change is documentation plus one helper, and it leaves both lists alone.

## Review Focus

Five input classes the spec implies and no task's prose would otherwise cover. Each
line's test is in the task named beside it.

1. **A filename outside ASCII.** A reasonable person expects the download to arrive
   named, and expects a name the engine cannot put in a header to be encoded rather
   than to lose the answer. It is the case that fails today with a `TypeError` out of
   `application.handle` and no response at all. (Task 3)
2. **A filename carrying a line break, a NUL, or a path separator** — `a/b.csv`,
   `a\b.csv`, `a\nb.csv`. A `TypeError` naming what is wrong, thrown before a byte of
   the header is written, rather than an engine message from inside response
   construction, and with the settings object untouched. (Task 3)
3. **A file larger than the declared `maxSize`.** `422` and the handler never runs, so
   the limit is the schema's and not something the handler has to remember. (Task 1)
4. **Anything about a file's type, in both directions.** A `type`-constrained upload
   whose bytes carry no recognizable signature is refused by
   `t.File({ type: "text/plain" })` even when the part says `text/plain`; and the type
   the handler receives, `file.type`, is the client's filename mapped through a MIME
   table, so a part named `photo.png` declared `text/plain` arrives as `image/png`. The
   document has to say both, because a reader who constrained a content type will read
   the first as their own bug and trust the second. (Task 1 pins the second, Task 2
   states both.)
5. **A static asset that is not there.** Bun's native route answers its own bare `404`
   with no content type — and the response body is not a Problem Details document,
   which is the half a reader will assume until they meet it. The suite reaches it
   through a real socket, beside a framework route that still answers, so a future
   change that routes the platform's error mapping into a native route fails loudly.
   (Task 4)

---

### Task 1: The upload example

**Files:**

- Create: `examples/files/package.json`
- Create: `examples/files/tsconfig.json` (copy of `examples/validation/tsconfig.json`)
- Create: `examples/files/vite.config.ts` (copy of `examples/validation/vite.config.ts`)
- Create: `examples/files/src/app.module.ts`
- Create: `examples/files/src/files.controller.ts`
- Create: `examples/files/src/main.ts`
- Create: `examples/files/test/application.ts`
- Create: `examples/files/test/uploads.e2e-spec.ts`
- Create: `examples/files/README.md`
- Modify: `package.json` (the `example:*` script block)
- Modify: `examples/README.md` (the index table)
- Modify: `examples/AGENTS.md:8-9` (the name list)
- Modify: `bun.lock` (via `bun install`, never by hand)
- Test: `examples/files/test/uploads.e2e-spec.ts`

**Interfaces:**

- Consumes: nothing from an earlier task.
- Produces: `AppModule` from `examples/files/src/app.module.ts`, and the helpers
  `createApplication()`, `get(application, path, init?)`,
  `upload(application, path, form)`, `file(name, bytes, type?)`, and
  `form(parts)` from `examples/files/test/application.ts`. Tasks 3 and 4 extend the
  controller this task creates and reuse those helpers unchanged.

- [ ] **Step 1: Create the package skeleton**

`examples/files/package.json`:

```json
{
  "name": "@aponiajs/example-files",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/main.ts",
    "build": "bun build ./src/main.ts --outdir ./dist --target bun",
    "test": "bun test ../../examples/files/test/*.e2e-spec.ts",
    "check": "vp check"
  },
  "dependencies": {
    "@aponiajs/common": "workspace:*",
    "@aponiajs/platform-elysia": "workspace:*",
    "elysia": "^1.4.30"
  }
}
```

Copy `examples/validation/tsconfig.json` and `examples/validation/vite.config.ts` into
`examples/files/` unchanged. The tsconfig is not optional: without
`experimentalDecorators` and `emitDecoratorMetadata` this example answers `404` from
its own directory while passing from the repository root.

- [ ] **Step 2: Write the request helpers**

`examples/files/test/application.ts`:

```ts
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";

/** Each suite builds the real application and drives it through `handle`. */
export function createApplication(): Promise<AponiaElysiaApplication> {
  return AponiaFactory.create(AppModule, { logger: false });
}

export function get(
  application: AponiaElysiaApplication,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return Promise.resolve(application.handle(new Request(`http://localhost${path}`, init)));
}

/**
 * A multipart request carries the boundary its body was encoded with, so the
 * `content-type` header is the engine's to write and must not be set by hand.
 */
export function upload(
  application: AponiaElysiaApplication,
  path: string,
  form: FormData,
): Promise<Response> {
  return Promise.resolve(
    application.handle(new Request(`http://localhost${path}`, { method: "POST", body: form })),
  );
}

/** One uploaded part, with the name on disk, the bytes, and the declared type. */
export function file(
  name: string,
  bytes: Uint8Array | string,
  type = "application/octet-stream",
): File {
  return new File([bytes], name, { type });
}

/** Builds a form from `{ field: part | parts[] }`, appending in declaration order. */
export function form(parts: Record<string, File | string | readonly File[]>): FormData {
  const body = new FormData();
  for (const [field, value] of Object.entries(parts)) {
    const entries = typeof value === "string" || value instanceof File ? [value] : value;
    for (const entry of entries) {
      body.append(field, entry);
    }
  }
  return body;
}
```

- [ ] **Step 3: Write the failing test**

`examples/files/test/uploads.e2e-spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { createApplication, file, form, upload } from "./application.ts";

let application: AponiaElysiaApplication;

beforeAll(async () => {
  application = await createApplication();
});

afterAll(async () => {
  await application.close();
});

describe("uploading a file", () => {
  test("an object schema carries the part to @Body() as a File", async () => {
    const response = await upload(
      application,
      "/files/single",
      form({ file: file("report.dat", "hello") }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "report.dat", size: 5 });
  });

  test("the part's type comes from its filename, not from the declared one", async () => {
    // Measured on bun 1.4.2 / elysia 1.4.30, through raw Elysia as well as through
    // this framework: the multipart parser discards the content type the client
    // declared and maps the filename through a MIME table. `file.type` is therefore
    // a fact about the name the client chose, never about the bytes it sent.
    const response = await upload(
      application,
      "/files/single",
      form({ file: file("photo.png", "not a png at all", "text/plain") }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "photo.png", type: "image/png" });
  });

  test('@Body("file") hands over the parsed File directly', async () => {
    const response = await upload(
      application,
      "/files/named",
      form({ file: file("avatar.png", "not really a png", "image/png") }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: "avatar.png",
      size: 16,
      type: "image/png",
    });
  });

  test("t.Files() accepts several parts under one field, in order", async () => {
    const response = await upload(
      application,
      "/files/many",
      form({
        files: [file("one.bin", new Uint8Array([1])), file("two.bin", new Uint8Array([2]))],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ count: 2, names: ["one.bin", "two.bin"] });
  });

  test("t.Form() parses a mixed form beside a file", async () => {
    const response = await upload(
      application,
      "/files/form",
      form({ label: "quarterly", file: file("report.csv", "a,b\n") }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ label: "quarterly", name: "report.csv" });
  });

  test("a part above the declared maxSize is refused before the handler runs", async () => {
    const response = await upload(
      application,
      "/files/single",
      form({ file: file("huge.bin", new Uint8Array(1_048_577)) }),
    );

    expect(response.status).toBe(422);
  });

  test("t.File() as the whole body refuses the parsed multipart body", async () => {
    const response = await upload(
      application,
      "/files/top-level",
      form({ file: file("report.txt", "hello") }),
    );

    // The boundary this example exists to write down: Elysia's own validation
    // answer, which is not the platform's Problem Details shape.
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      type: "validation",
      on: "body",
      expected: "File",
      found: "File",
    });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `bun test ./examples/files/test/*.e2e-spec.ts`
Expected: FAIL — `Cannot find module '../src/app.module.ts'`.

- [ ] **Step 5: Write the application**

`examples/files/src/app.module.ts`:

```ts
import { Module } from "@aponiajs/common";
import { FilesController } from "./files.controller.ts";

@Module({ controllers: [FilesController] })
export class AppModule {}
```

`examples/files/src/files.controller.ts`:

```ts
import { Body, Controller, Post } from "@aponiajs/common";
import { t } from "elysia";

/**
 * A file is an ordinary body value: the `body` slot carries it, `@Body()` hands
 * it over, and the handler receives the platform's own `File`. Nothing here is
 * Aponia-specific except the decorators around it.
 */
@Controller("files")
export class FilesController {
  @Post("single", { body: t.Object({ file: t.File({ maxSize: "1m" }) }) })
  uploadSingle(@Body() body: { file: File }) {
    return { name: body.file.name, size: body.file.size, type: body.file.type };
  }

  @Post("named", { body: t.Object({ file: t.File() }) })
  uploadNamed(@Body("file") file: File) {
    return { name: file.name, size: file.size, type: file.type };
  }

  @Post("many", { body: t.Object({ files: t.Files({ maxItems: 3 }) }) })
  uploadMany(@Body("files") files: File[]) {
    return { count: files.length, names: files.map((entry) => entry.name) };
  }

  @Post("form", { body: t.Form({ label: t.String(), file: t.File() }) })
  uploadForm(@Body() body: { label: string; file: File }) {
    return { label: body.label, name: body.file.name };
  }

  // The shape a reader tries first, kept here because it is the one that refuses:
  // `t.File()` validates a value that is already a `File`, so as the whole body
  // it rejects the parsed multipart body with `422`.
  @Post("top-level", { body: t.File() })
  uploadTopLevel(@Body() body: File) {
    return { name: body.name };
  }
}
```

`examples/files/src/main.ts`:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

export async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule);
  await application.listen(Number(Bun.env.PORT ?? 3080));
}

if (import.meta.main) {
  await bootstrap();
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `bun test ./examples/files/test/*.e2e-spec.ts`
Expected: 7 pass, 0 fail.

- [ ] **Step 7: Write the example README**

`examples/files/README.md`:

````markdown
# Files

A file is an ordinary body value: Elysia parses the multipart request, `t.File()`
validates the part, and `@Body()` hands the handler the platform's own `File`. The
example measures every working shape and the one that refuses — `t.File()` as the
whole body — because that boundary is the one a reader reaches for first. It also pins
where the part's `type` comes from: the filename the client chose, never the content
type it declared.

## Run

```bash
bun run example:files
```

## Test

```bash
bun run --cwd examples/files test
```

`test/uploads.e2e-spec.ts` asserts each declaration through
`application.handle(new Request(...))`: the object form, `@Body("file")`, `t.Files()`,
`t.Form()`, the `maxSize` refusal, the filename rather than the declaration deciding
`file.type`, and the `422` a whole-body `t.File()` answers.

[Every example](../README.md)
````

- [ ] **Step 8: Register the example**

1. In the root `package.json`, add after `"example:descriptors"`:

```json
"example:files": "bun run --cwd examples/files start",
```

2. In `examples/README.md`, append this row to the table (it is the last one; the rows
   are ordered by port):

```markdown
| `files` | Uploads through the body slot, named downloads, and static assets | 3080 | `bun run example:files` |
```

3. In `examples/AGENTS.md:8-9`, add `files` to the end of the named list, so it reads
   `…, descriptors, websockets, files`.

4. Register the workspace in the lockfile:

```bash
bun install
```

Expected: `bun.lock` gains `examples/files`. Without this the frozen install CI runs
fails before any test does.

- [ ] **Step 9: Run the gates and commit**

```bash
bun run check --fix
bun test ./examples/files/test/*.e2e-spec.ts
bun run test:examples
bun run build
find packages -name '*.d.ts' -path '*/src/*' -delete
git add examples/files package.json examples/README.md examples/AGENTS.md bun.lock
git commit -m "feat(examples): measure every upload shape the body slot accepts"
```

---

### Task 2: The upload documentation

**Files:**

- Create: `docs/files.md`
- Create: `docs/learn/15-files.md`
- Modify: `docs/learn/README.md` (the chapter table and the reference paragraph)
- Modify: `docs/learn/14-devtools.md:177` (it stops being the last chapter)
- Modify: `docs/AGENTS.md` (the published-document table)
- Modify: `README.md:13-23` (the navigation list)

**Interfaces:**

- Consumes: the measured shapes and the example from Task 1, which the reference page
  names as `examples/files` (a code span, not a link — the directory is not a page).
- Produces: `docs/files.md`, whose `## Downloads` and `## Static assets` sections
  Tasks 3 and 4 append to, and `docs/learn/15-files.md`, which Task 3 extends with the
  download snippet.

- [ ] **Step 1: Create the reference page**

`docs/files.md`:

````markdown
# Files

A file is a body value. Elysia parses a multipart request into a `File`, the `body`
slot validates it, and `@Body()` hands it to the handler exactly as it hands over any
other parsed body. There is no Aponia file type, no file parameter decorator, and no
file schema slot, because none of them would add anything the substrate does not
already do.

## Uploads

| Declaration                            | Result                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `body: t.Object({ file: t.File() })`   | `200`; `@Body()` is `{ file }` and `file instanceof File` is true            |
| `@Body("file")` over that same schema  | `200`; the parameter is the `File` directly                                  |
| `body: t.Object({ files: t.Files() })` | `200`; the body is `{ files: File[] }`                                       |
| `body: t.Form({ file: t.File() })`     | `200`; the body is the parsed form, with the part as a `File`                |
| `body: t.File()`                       | **`422`**, `Expected kind 'File'` — `expected` and `found` are both `"File"` |

```ts
import { Body, Controller, Post } from "@aponiajs/common";
import { t } from "elysia";

@Controller("files")
export class FilesController {
  @Post("single", { body: t.Object({ file: t.File({ maxSize: "3m" }) }) })
  upload(@Body() body: { file: File }) {
    return { name: body.file.name, size: body.file.size };
  }

  @Post("many", { body: t.Object({ files: t.Files() }) })
  uploadMany(@Body("files") files: File[]) {
    return { count: files.length };
  }
}
```

### The type is the filename

`file.type` is not the content type the request declared. The multipart parser discards
that header and looks the filename up in a MIME table, so the value is derived from the
name the client chose: a part named `photo.png` arrives as `image/png` even when the
request declared `text/plain`, `notes.txt` arrives as `text/plain;charset=utf-8`, a name
with no extension arrives as `""`, and `.xyz` arrives as `chemical/x-xyz`. The declared
type never reaches the handler.

Treat it as input rather than as a fact about the bytes. A client chooses its own
filename, so a content check belongs on the content — `t.File({ type })` inspects it —
or in the handler, never on `file.type`. Measured on Bun 1.4.2 with Elysia 1.4.30,
identically through raw Elysia and through this framework.

### The shape that refuses

`t.File()` validates a value that is already a `File`. As a whole-body schema it is
therefore asked to validate the object Elysia built from the multipart request, and it
answers `422` — even when the request is a valid single-file upload. A single file is
named inside something: an object, `t.Form`, or `t.Files` for one-or-more.

That `422` is Elysia's own validation answer (`type: "validation"`,
`application/json`), not the platform's RFC 9457 Problem Details. The platform's
default mapping declines a status Elysia already decided, so a rejected upload keeps
the response shape Elysia gives it.

### Limits

`minSize` and `maxSize` are declared on the validator and enforced before the handler
runs, with no dependency and no Aponia surface:

```ts
@Post("upload", { body: t.Object({ file: t.File({ minSize: "1k", maxSize: "3m" }) }) })
```

`type` is a content check rather than a content-type check. It inspects the file's
bytes, so a plain-text file whose part says `text/plain` is refused by
`t.File({ type: "text/plain" })` with `has invalid file type`, because no signature
identifies it. Declare `type` for formats that carry one — images, audio, video,
archives — and check anything finer in the handler. Elysia's `extension` option is not
part of this surface: it is absent from the declared options and is not enforced
through `t.File`.

`examples/files` runs every shape above, the refusal included, as an application you can
start with `bun run example:files`.
````

- [ ] **Step 2: Create the learn chapter**

`docs/learn/15-files.md`:

````markdown
# 15 · Files

**Use when:** a route receives an uploaded file, or answers with one.

An upload is a body. Elysia parses the multipart request, so the `body` slot is where a
file is declared and `@Body()` is how it arrives:

```ts
import { Body, Controller, Post } from "@aponiajs/common";
import { t } from "elysia";

@Controller("files")
export class FilesController {
  @Post()
  upload(@Body("file") file: File) {
    return { name: file.name, size: file.size };
  }
}
```

```ts
await fetch("http://localhost:3080/files", { method: "POST", body: form });
```

`form` is a `FormData` holding the file, and the request sets no `content-type` header:
the engine writes the boundary. `t.File()` alone as the body schema refuses the
upload; name it inside `t.Object({ file: t.File() })`, or reach for `t.Files()` when a
request may carry several.

The handler receives the platform's own `File`. There is no Aponia file type to learn,
and `@Body("file")` already selects one part without a dedicated decorator.

Next: nothing — this is the last chapter. ·
Deep dive: [files](../files.md)
````

- [ ] **Step 3: Chain the chapter and list it**

1. Replace the tail of `docs/learn/14-devtools.md` (line 177 onward):

```markdown
Next: nothing — this is the last chapter. ·
Deep dive: [devtools](../devtools.md)
```

with:

```markdown
Next: [15 · Files](./15-files.md) · Deep dive: [devtools](../devtools.md)
```

2. Append this row to the table in `docs/learn/README.md`:

```markdown
| [15 · Files](./15-files.md) | How a route receives an uploaded file, and how it answers with one |
```

3. In the "Reference documents live one directory up:" paragraph of
   `docs/learn/README.md`, add `[files](../files.md)` to the list.

- [ ] **Step 4: Add the page to the two prose indexes**

1. In `docs/AGENTS.md`, add a row to the published-document table, after the
   `native-plugins.md` row:

```markdown
| `files.md` | Uploaded files, named downloads, and serving static assets |
```

2. In `README.md`, add `[Files](./docs/files.md) ·` to the navigation list that ends
   with `[Devtools](./docs/devtools.md)`, before that entry.

- [ ] **Step 5: Run the documentation gates and commit**

```bash
bun run check --fix
bun test scripts/learning-path.spec.ts scripts/documentation-versions.spec.ts scripts/retired-literals.spec.ts
rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .
git add docs/files.md docs/learn/15-files.md docs/learn/README.md docs/learn/14-devtools.md docs/AGENTS.md README.md
git commit -m "docs(files): teach uploads where the reader looks for them"
```

Expected: the learning-path guard passes with 15 contiguous chapters, and the Thai scan
reports nothing.

---

### Task 3: The download helper

**Files:**

- Create: `packages/platform-elysia/src/routing/download-file.types.ts`
- Create: `packages/platform-elysia/src/routing/download-file.ts`
- Modify: `packages/platform-elysia/src/index.ts` (the `routing` export group)
- Modify: `packages/platform-elysia/llms.txt` (exports and public types)
- Modify: `packages/platform-elysia/README.md` (a `## Downloads` section, before
  `## Execution enhancers`)
- Create: `packages/platform-elysia/tests/download-file.test.ts`
- Create: `packages/platform-elysia/tests-vp/download-file.conformance.ts`
- Create: `examples/files/data/measurements.csv`
- Modify: `examples/files/src/files.controller.ts` (two download routes)
- Create: `examples/files/test/downloads.e2e-spec.ts`
- Modify: `examples/files/README.md`
- Modify: `docs/files.md` (append `## Downloads`)
- Modify: `docs/learn/15-files.md` (the download half)

**Interfaces:**

- Consumes: `examples/files/test/application.ts` from Task 1 (`createApplication`,
  `get`), `docs/files.md` from Task 2.
- Produces: `downloadFile(settings, path, filename, options?)` and
  `DownloadFileOptions`, both re-exported from `@aponiajs/platform-elysia`.

- [ ] **Step 1: Write the failing test**

`packages/platform-elysia/tests/download-file.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Controller, Get, Module, Set, type RouteResponseSettings } from "@aponiajs/common";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { AponiaFactory, downloadFile, type AponiaElysiaApplication } from "../src/index.ts";

/** A settings object shaped like the one the compiled invoker hands a handler. */
function settings(): RouteResponseSettings {
  return { headers: {} };
}

describe("downloadFile", () => {
  test("names an attachment by default, with both name parameters", () => {
    const set = settings();

    downloadFile(set, "/tmp/report.txt", "report.txt");

    expect(set.headers["content-disposition"]).toBe(
      "attachment; filename=\"report.txt\"; filename*=UTF-8''report.txt",
    );
  });

  test("names a render when the caller asks for one", () => {
    const set = settings();

    downloadFile(set, "/tmp/report.txt", "report.txt", { disposition: "inline" });

    expect(set.headers["content-disposition"]).toBe(
      "inline; filename=\"report.txt\"; filename*=UTF-8''report.txt",
    );
  });

  test("encodes a name outside ASCII and keeps the value inside the ASCII range", () => {
    const set = settings();

    downloadFile(set, "/tmp/report.csv", "Ω 2026.csv");

    const value = String(set.headers["content-disposition"]);
    expect(value).toBe("attachment; filename=\"_ 2026.csv\"; filename*=UTF-8''%CE%A9%202026.csv");
    // The engine refuses a value carrying a code point above U+00FF, so the whole
    // header has to stay printable ASCII.
    expect(value).toMatch(/^[\x20-\x7e]+$/);
    const extended = value.slice(value.indexOf("filename*=") + "filename*=".length);
    expect(decodeURIComponent(extended.replace("UTF-8''", ""))).toBe("Ω 2026.csv");
  });

  test("escapes a quote in the fallback and encodes it in the extended value", () => {
    const set = settings();

    downloadFile(set, "/tmp/report.txt", 're"port.txt');

    expect(set.headers["content-disposition"]).toBe(
      'attachment; filename="re\\"port.txt"; filename*=UTF-8\'\'re%22port.txt',
    );
  });

  test("encodes the three characters an extended value cannot carry", () => {
    const set = settings();

    downloadFile(set, "/tmp/report.txt", "a*b'c%d.txt");

    // `'` separates the charset from the value and `%` starts an escape inside an
    // extended value, which is why neither is an attr-char and why the constant
    // that holds the set leaves them out.
    expect(set.headers["content-disposition"]).toBe(
      "attachment; filename=\"a*b'c%d.txt\"; filename*=UTF-8''a%2Ab%27c%25d.txt",
    );
  });

  test("keeps a control character out of the quoted fallback", () => {
    const set = settings();

    downloadFile(set, "/tmp/report.txt", "re\u0001port\u007f.txt");

    const value = String(set.headers["content-disposition"]);
    // A control character is legal in the extended value's percent-encoding and
    // nowhere in a quoted-string, so the fallback replaces it.
    expect(value).toBe("attachment; filename=\"re_port_.txt\"; filename*=UTF-8''re%01port%7F.txt");
    expect(value).toMatch(/^[\x20-\x7e]+$/);
  });

  test("refuses a filename that is a path or carries a control character", () => {
    for (const [filename, reason] of [
      ["reports/2026.csv", "path separator"],
      ["reports\\2026.csv", "path separator"],
      ["reports\n2026.csv", "line feed"],
      ["reports\r2026.csv", "carriage return"],
      ["reports\u00002026.csv", "NUL"],
    ] as const) {
      const set = settings();
      let thrown: unknown;

      try {
        downloadFile(set, "/tmp/report.csv", filename);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(TypeError);
      expect((thrown as TypeError).message).toContain(reason);
      // The refusal happens before the value is built, so nothing is half-written.
      expect(set.headers).toEqual({});
    }
  });
});

const downloadPath = join(tmpdir(), `aponia-download-${process.pid}.txt`);

@Controller("downloads")
class DownloadController {
  @Get()
  read(@Set() set: RouteResponseSettings) {
    return downloadFile(set, downloadPath, "Ω 2026.txt");
  }

  @Get("raw")
  readRaw(@Set() set: RouteResponseSettings) {
    // What a handler does without the helper: the raw name reaches the engine.
    set.headers["content-disposition"] = 'attachment; filename="Ω 2026.txt"';
    return "raw";
  }
}

@Module({ controllers: [DownloadController] })
class DownloadModule {}

describe("downloading a file through an application", () => {
  let application: AponiaElysiaApplication;

  beforeAll(async () => {
    await Bun.write(downloadPath, "measured,at\n1,now\n");
    application = await AponiaFactory.create(DownloadModule, { logger: false });
  });

  afterAll(async () => {
    await application.close();
    await unlink(downloadPath).catch(() => undefined);
  });

  test("streams the file under an encoded name", async () => {
    const response = await application.handle(new Request("http://localhost/downloads"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=\"_ 2026.txt\"; filename*=UTF-8''%CE%A9%202026.txt",
    );
    expect(await response.text()).toBe("measured,at\n1,now\n");
  });

  test("shows the raw value the helper exists to replace being refused", async () => {
    let thrown: unknown;

    try {
      await application.handle(new Request("http://localhost/downloads/raw"));
    } catch (error) {
      thrown = error;
    }

    // No response at all: the engine rejects the header value while the response
    // is constructed, and nothing catches it on the way out.
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as TypeError).message).toContain("content-disposition");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test packages/platform-elysia/tests/download-file.test.ts`
Expected: FAIL — `downloadFile` is not exported from `../src/index.ts`.

- [ ] **Step 3: Write the helper**

`packages/platform-elysia/src/routing/download-file.types.ts`:

```ts
/** How a download presents itself: as a file to save, or as content to render. */
export interface DownloadFileOptions {
  /** `attachment` (the default) names a download; `inline` names a render. */
  readonly disposition?: "attachment" | "inline";
}
```

`packages/platform-elysia/src/routing/download-file.ts`:

```ts
import type { RouteResponseSettings } from "@aponiajs/common";
import { file, type ElysiaFile } from "elysia";
import type { DownloadFileOptions } from "./download-file.types.ts";

/**
 * RFC 8187 §3.2.1's `attr-char`, less `ALPHA` and `DIGIT`, which the predicate
 * below reads by code range. `*`, `'`, and `%` are deliberately absent: they
 * carry meaning inside an extended value.
 */
const extendedValueAttributeCharacters = "!#$&+.^_`|~-";

/** The characters a filename may not carry, and what to call each one. */
const refusedFilenameCharacters = new Map([
  ["/", "a path separator"],
  ["\\", "a path separator"],
  ["\n", "a line feed"],
  ["\r", "a carriage return"],
  ["\u0000", "a NUL"],
]);

const utf8 = new TextEncoder();

function assertNameable(filename: string): void {
  for (const character of filename) {
    const refusal = refusedFilenameCharacters.get(character);
    if (refusal !== undefined) {
      throw new TypeError(
        `downloadFile refuses a filename carrying ${refusal}: the header value names a download, so it may not locate one and may not carry a line break.`,
      );
    }
  }
}

/**
 * The quoted ASCII fallback every client can read. Every code unit outside
 * printable ASCII is replaced, controls included, so the fallback is always a
 * valid quoted-string: RFC 7230's `qdtext` has no room for a control character,
 * and a value outside that grammar is not one a client has to parse the way it
 * was written. Replacing rather than transliterating is the same call — choosing
 * a Latin spelling for a name is the application's business, and the extended
 * parameter below carries the real name for everything that reads it.
 */
function asciiFallback(filename: string): string {
  let fallback = "";
  for (let index = 0; index < filename.length; index += 1) {
    const character = filename.charAt(index);
    const code = character.charCodeAt(0);
    if (character === '"') {
      fallback += '\\"';
    } else if (code < 0x20 || code > 0x7e) {
      fallback += "_";
    } else {
      fallback += character;
    }
  }
  return fallback;
}

function isAttributeCharacter(byte: number): boolean {
  const isDigit = byte >= 0x30 && byte <= 0x39;
  const isUpper = byte >= 0x41 && byte <= 0x5a;
  const isLower = byte >= 0x61 && byte <= 0x7a;
  return (
    isDigit ||
    isUpper ||
    isLower ||
    extendedValueAttributeCharacters.includes(String.fromCharCode(byte))
  );
}

/** The name as an RFC 8187 ext-value: the literal `UTF-8''`, then its bytes. */
function extendedValue(filename: string): string {
  let encoded = "";
  for (const byte of utf8.encode(filename)) {
    encoded += isAttributeCharacter(byte)
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return `UTF-8''${encoded}`;
}

/**
 * RFC 6266 recommends sending both parameters for every name: the extended one
 * carries the real name, the quoted one is what an older client saves. One
 * construction for every name, rather than a branch for ASCII.
 */
function contentDisposition(disposition: "attachment" | "inline", filename: string): string {
  assertNameable(filename);
  return `${disposition}; filename="${asciiFallback(filename)}"; filename*=${extendedValue(filename)}`;
}

/**
 * Names a download and returns the file the platform streams.
 *
 * A handler already streams a file it returns — with a detected content type,
 * `accept-ranges`, and range support — but it cannot name one. This writes the
 * single header that names it into the settings the handler was handed, and
 * returns `file(path)` unchanged, so the response stays Elysia's.
 *
 * @param settings - the `@Set()` / `@Res()` object the compiled invoker passes.
 * @param path - the file to stream, as `Bun.file` and Elysia's `file` read it.
 * @param filename - the name the client saves or renders, encoded per RFC 8187.
 * @param options - `attachment` (the default) or `inline`.
 * @throws TypeError when `filename` carries a path separator, a line break, or a NUL.
 */
export function downloadFile(
  settings: RouteResponseSettings,
  path: string,
  filename: string,
  options?: DownloadFileOptions,
): ElysiaFile {
  settings.headers["content-disposition"] = contentDisposition(
    options?.disposition ?? "attachment",
    filename,
  );
  return file(path);
}
```

- [ ] **Step 4: Export it and run the test**

In `packages/platform-elysia/src/index.ts`, in the `routing` group (the block that
starts at the `ElysiaInputSchema` type export):

```ts
export { downloadFile } from "./routing/download-file.ts";
export type { DownloadFileOptions } from "./routing/download-file.types.ts";
```

Run: `bun test packages/platform-elysia/tests/download-file.test.ts`
Expected: 9 pass, 0 fail.

- [ ] **Step 5: Mirror the public contract in the Vite+ lane**

`packages/platform-elysia/tests-vp/download-file.conformance.ts`:

```ts
import { Controller, Get, Module, Set, type RouteResponseSettings } from "@aponiajs/common";
import type { ElysiaFile } from "elysia";
import { AponiaFactory, downloadFile, type DownloadFileOptions } from "../src/index.ts";

type VitePlusTest = typeof import("vite-plus/test");

declare const test: VitePlusTest["test"];
declare const expect: VitePlusTest["expect"];

// The settled contract, pinned: the helper writes the settings it is handed and
// returns the file the platform streams. A signature that grew a parameter or
// started returning a Response fails `bun run check` here.
const settled = downloadFile satisfies (
  settings: RouteResponseSettings,
  path: string,
  filename: string,
  options?: DownloadFileOptions,
) => ElysiaFile;

@Controller("conformance")
class ConformanceController {
  @Get()
  read(@Set() set: RouteResponseSettings) {
    // The lane never reads the body, so the path only has to be one that exists
    // wherever the two lanes run from: the repository root.
    return downloadFile(set, "package.json", "conformance.txt");
  }
}

@Module({ controllers: [ConformanceController] })
class ConformanceModule {}

test("names a download through the compiled invoker", async () => {
  const application = await AponiaFactory.create(ConformanceModule, { logger: false });
  try {
    const response = await application.handle(new Request("http://localhost/conformance"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=\"conformance.txt\"; filename*=UTF-8''conformance.txt",
    );
  } finally {
    await application.close();
  }
});

void settled;
```

- [ ] **Step 6: Advertise the export**

In `packages/platform-elysia/llms.txt`, add to "What this package exports":

```markdown
- [downloadFile](https://github.com/aponiajs/aponiajs/blob/release/alpha/packages/platform-elysia/src/routing/download-file.ts): writes the `content-disposition` value that names a download and returns the file the platform streams.
```

and to "Public types":

```markdown
- [DownloadFileOptions](https://github.com/aponiajs/aponiajs/blob/release/alpha/packages/platform-elysia/src/routing/download-file.types.ts): `attachment` or `inline`, the disposition a download is named with.
```

Both paths must exist: `scripts/package-llms.spec.ts` resolves the path behind a
repository blob URL against this working tree and fails on a link that 404s.

In `packages/platform-elysia/README.md`, add this section before `## Execution enhancers`:

````markdown
## Downloads

A handler that returns a file streams it with a detected content type, `accept-ranges`,
and range support, but the response carries no name. `downloadFile` writes the one
header that names it and returns the value the platform already streams:

```ts
import { Controller, Get, Param, Set, type RouteResponseSettings } from "@aponiajs/common";
import { downloadFile } from "@aponiajs/platform-elysia";

@Controller("reports")
export class ReportController {
  @Get(":id")
  read(@Param("id") id: string, @Set() set: RouteResponseSettings) {
    return downloadFile(set, `/srv/reports/${id}.csv`, `${id}.csv`);
  }
}
```

The value follows RFC 6266 with the RFC 8187 extended parameter, so a name outside
ASCII is encoded rather than refused: `filename*` carries the name as UTF-8 and a
quoted ASCII fallback rides beside it. Pass `{ disposition: "inline" }` to render
instead of saving. A name carrying a line break, a NUL, or a path separator is refused
with a `TypeError` before any header is written.
````

- [ ] **Step 7: Add the download half to both documents**

1. Append to `docs/files.md`:

````markdown
## Downloads

A handler that returns a `File`, a `Bun.file(...)`, or Elysia's `file(...)` streams it:
the platform detects the content type and the substrate adds `accept-ranges` and range
support. What it cannot do is name it — `content-disposition` is absent — and a name
written by hand into that header fails on the case a non-English application hits
first. A code point above `U+00FF` is outside what a header value may carry, so the
value escapes `application.handle` as a `TypeError` with no response at all.

`downloadFile` writes that one value and returns the file:

```ts
import { Controller, Get, Param, Set, type RouteResponseSettings } from "@aponiajs/common";
import { downloadFile } from "@aponiajs/platform-elysia";

@Controller("reports")
export class ReportController {
  @Get(":id")
  read(@Param("id") id: string, @Set() set: RouteResponseSettings) {
    return downloadFile(set, `/srv/reports/${id}.csv`, `${id}.csv`);
  }
}
```

It constructs no `Response`, opens no stream, and reads no file: the returned value is
what the platform streams, so range requests and content-type detection stay Elysia's.
The name follows RFC 6266 with the RFC 8187 extended parameter — `filename*`
carries the real name UTF-8 percent-encoded, and a quoted ASCII fallback carries a
name an older client can save — so both parameters are always present and a pure-ASCII
name is the ordinary case rather than a branch. `{ disposition: "inline" }` renders
instead of saving. A name carrying a line break, a NUL, or a path separator is refused
with a `TypeError`: a value an application hands a helper while it runs is a caller
mistake, which is the runtime half of the convention the batch delivery document
states.
````

2. In `docs/learn/15-files.md`, replace the closing pair with:

````markdown
A download is named rather than rebuilt. `downloadFile` writes the header the response
cannot name itself with — encoded, so a name outside ASCII arrives intact — and returns
the file the platform streams:

```ts
import { Get, Set, type RouteResponseSettings } from "@aponiajs/common";
import { downloadFile } from "@aponiajs/platform-elysia";

@Get("download")
download(@Set() set: RouteResponseSettings) {
  return downloadFile(set, "/srv/reports/2026.csv", "2026.csv");
}
```

Next: nothing — this is the last chapter. ·
Deep dive: [files](../files.md)
````

- [ ] **Step 8: Exercise the helper in the example**

1. Create `examples/files/data/measurements.csv`:

```text
station,reading
north,12.4
south,9.8
```

2. Add to `examples/files/src/files.controller.ts`: the `Get` and `Set` decorators in
   its `@aponiajs/common` import, `downloadFile` and `type RouteResponseSettings` from
   `@aponiajs/platform-elysia`, this import and constant under the existing imports:

```ts
import { resolve } from "node:path";

/**
 * Resolved from this file, never from the working directory: a route that serves a
 * file must answer the same way however the application was started.
 */
const reportPath = resolve(import.meta.dir, "../data/measurements.csv");
```

and these two routes to the controller:

```ts
  @Get("download")
  download(@Set() set: RouteResponseSettings) {
    return downloadFile(set, reportPath, "measurements.csv");
  }

  @Get("download/named")
  render(@Set() set: RouteResponseSettings) {
    return downloadFile(set, reportPath, "Ω 2026.csv", { disposition: "inline" });
  }
```

3. Create `examples/files/test/downloads.e2e-spec.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { createApplication, get } from "./application.ts";

const reportPath = resolve(import.meta.dir, "../data/measurements.csv");
let application: AponiaElysiaApplication;
let report: string;

beforeAll(async () => {
  application = await createApplication();
  report = await Bun.file(reportPath).text();
});

afterAll(async () => {
  await application.close();
});

test("a download names itself and streams the file", async () => {
  const response = await get(application, "/files/download");

  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toBe(
    "attachment; filename=\"measurements.csv\"; filename*=UTF-8''measurements.csv",
  );
  expect(await response.text()).toBe(report);
});

test("a name outside ASCII is encoded, and the header stays ASCII", async () => {
  const response = await get(application, "/files/download/named");

  const value = String(response.headers.get("content-disposition"));
  expect(response.status).toBe(200);
  expect(value).toBe("inline; filename=\"_ 2026.csv\"; filename*=UTF-8''%CE%A9%202026.csv");
  expect(value).toMatch(/^[\x20-\x7e]+$/);
  expect(await response.text()).toBe(report);
});
```

4. Correct the closing paragraph of `examples/files/README.md`, which enumerates what the
   suite asserts and was written before Task 1's case list grew. It must read:

```markdown
`test/uploads.e2e-spec.ts` asserts each declaration through
`application.handle(new Request(...))`: the object form, `@Body("file")`, `t.Files()`,
`t.Form()`, the `maxSize` refusal, the filename rather than the declaration deciding
`file.type`, and the `422` a whole-body `t.File()` answers.
```

5. Append to `examples/files/README.md`, before the `[Every example](../README.md)`
   line:

```markdown
## Downloads

Two routes answer with the same file: one as an attachment under its own name, one
inline under a name outside ASCII, which is percent-encoded per RFC 8187 rather than
reaching the engine raw. `test/downloads.e2e-spec.ts` asserts both the header and the
bytes.
```

- [ ] **Step 9: Run the gates and commit**

```bash
bun run check --fix
bun test packages/platform-elysia/tests/download-file.test.ts packages/platform-elysia/tests/route-parameters.test.ts
bun run --filter @aponiajs/platform-elysia test
vp test packages/platform-elysia/tests-vp/download-file.conformance.ts
bun test ./examples/files/test/*.e2e-spec.ts
bun test scripts/package-llms.spec.ts
git add packages/platform-elysia examples/files docs/files.md docs/learn/15-files.md
git commit -m "feat(platform-elysia): name a download without rebuilding the response"
```

---

### Task 4: The static recipe

**Files:**

- Create: `examples/files/public/index.html`
- Create: `examples/files/public/style.css`
- Create: `examples/files/src/static-assets.ts`
- Modify: `examples/files/src/main.ts`
- Create: `examples/files/test/static-assets.e2e-spec.ts`
- Modify: `examples/files/README.md`
- Modify: `docs/files.md` (append `## Static assets`)

**Interfaces:**

- Consumes: `AppModule` and the example from Task 1, and the `/files/download`
  route Task 3 adds — this task's third case fetches it to show a framework route
  answering beside the native one.
- Produces: `assetsDirectory` and `configureStaticAssets` from
  `examples/files/src/static-assets.ts`, and the last section of `docs/files.md`.

- [ ] **Step 1: Write the failing test**

`examples/files/test/static-assets.e2e-spec.ts`:

```ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { createServer } from "node:net";
import { AponiaFactory, type AponiaElysiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";
import { configureStaticAssets } from "../src/static-assets.ts";

/**
 * A native directory route is Bun's, not Elysia's: it is composed when the server
 * starts, so this suite listens on a reserved ephemeral port instead of driving
 * `handle` the way every other lane does.
 */
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

let application: AponiaElysiaApplication;

beforeAll(async () => {
  application = await AponiaFactory.create(AppModule, {
    logger: false,
    configureNative: configureStaticAssets,
  });
  await application.listen(await reservePort());
});

afterAll(async () => {
  await application.close();
});

test("serves an asset under the prefix with its own content type", async () => {
  const response = await fetch(`${application.getUrl()}/assets/style.css`);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/css");
});

test("answers a missing asset the way Bun answers, not as Problem Details", async () => {
  const response = await fetch(`${application.getUrl()}/assets/missing.css`);

  expect(response.status).toBe(404);
  expect(response.headers.get("content-type")).toBeNull();
  expect(await response.text()).not.toContain("problem+json");
});

test("a framework route answers beside the native one", async () => {
  const response = await fetch(`${application.getUrl()}/files/download`);

  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toContain("attachment");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test ./examples/files/test/static-assets.e2e-spec.ts`
Expected: FAIL — `Cannot find module '../src/static-assets.ts'`.

- [ ] **Step 3: Add the assets and the configurator**

`examples/files/public/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Files example</title>
    <link rel="stylesheet" href="./style.css" />
  </head>
  <body>
    <h1>Static assets</h1>
    <p>Served by Bun's native directory route, outside Elysia's lifecycle.</p>
  </body>
</html>
```

`examples/files/public/style.css`:

```css
body {
  font-family: system-ui, sans-serif;
  margin: 4rem auto;
  max-width: 40rem;
}
```

`examples/files/src/static-assets.ts`:

```ts
import { resolve } from "node:path";
import type { NativeElysiaConfigurator } from "@aponiajs/platform-elysia";

/**
 * Resolved from this file. Bun reads a directory route's `dir` relative to the
 * process working directory, so `./public` works when the example is started from
 * its own directory and throws `ENOENT` everywhere else.
 */
export const assetsDirectory = resolve(import.meta.dir, "../public");

/**
 * Mounts the assets at `/assets/*` on the native application.
 *
 * The route is registered on `config.serve`, never through `listen`'s options: the
 * Bun adapter builds the routes it passes to `Bun.serve` from the application's own
 * routes merged with `config.serve.routes`, so an option given to `listen` is
 * overwritten. The prefix has to end in `/*`; that is the shape Bun's own route
 * requires.
 */
export const configureStaticAssets: NativeElysiaConfigurator = (native) => {
  native.config.serve = {
    ...native.config.serve,
    routes: { ...native.config.serve?.routes, "/assets/*": { dir: assetsDirectory } },
  };
  return native;
};
```

- [ ] **Step 4: Wire it into the example's own boot**

`examples/files/src/main.ts` becomes:

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";
import { configureStaticAssets } from "./static-assets.ts";

export async function bootstrap(): Promise<void> {
  const application = await AponiaFactory.create(AppModule, {
    configureNative: configureStaticAssets,
  });
  await application.listen(Number(Bun.env.PORT ?? 3080));
}

if (import.meta.main) {
  await bootstrap();
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test ./examples/files/test/static-assets.e2e-spec.ts`
Expected: 3 pass, 0 fail.

- [ ] **Step 6: Document the recipe**

Append to `docs/files.md`:

````markdown
## Static assets

No AponiaJS package serves files. Two paths exist, they are not equivalent, and the
difference is one an application has to know before it chooses.

| Path                           | Needs                                                  | Inside Elysia's lifecycle | Cost                                                                       |
| ------------------------------ | ------------------------------------------------------ | ------------------------- | -------------------------------------------------------------------------- |
| `@elysia/static` via `plugins` | `bun add @elysia/static` in the application            | Yes                       | A dependency the application owns; the framework gains nothing             |
| Bun native directory route     | `configureNative` setting `native.config.serve.routes` | **No**                    | The route leaves Elysia entirely, and the platform's error mapping with it |

The plugin keeps the request inside Elysia, so the framework's hooks, its enhancers,
and its error path still apply to it. The native route is Bun's: it answers `404` with
no content type and no Problem Details, because the platform's default mapping is
compiled only into the routes the platform mounts. It is also the one that arrives
with the hardening a file server needs — root-confined opens, canonical-path rejection,
`Last-Modified` and `ETag`, single-range requests — and it costs no dependency.

```ts
import { resolve } from "node:path";
import type { NativeElysiaConfigurator } from "@aponiajs/platform-elysia";

export const configureStaticAssets: NativeElysiaConfigurator = (native) => {
  native.config.serve = {
    ...native.config.serve,
    routes: {
      ...native.config.serve?.routes,
      "/assets/*": { dir: resolve(import.meta.dir, "./public") },
    },
  };
  return native;
};
```

Three details decide whether that works. The route belongs on `config.serve`, not in
the options `listen` takes: the Bun adapter builds the routes it hands to `Bun.serve`
from the application's own routes merged with `config.serve.routes`, so an
`options.routes` is overwritten. The prefix must end in `/*`. And `dir` is read
relative to the process working directory, so resolve it — a relative path works when
the application is started from its own directory and throws `ENOENT` from anywhere
else.

Reach for the plugin when the asset route has to behave like a route; reach for the
native route when it has to be a fast file server and the application accepts that it
answers the way Bun answers.
````

- [ ] **Step 7: Extend the example README**

Append to `examples/files/README.md`, before the `[Every example](../README.md)` line:

```markdown
## Static assets

`public/` is served under `/assets/*` by a Bun native directory route, mounted through
`configureNative`. Because that route is composed when the server starts, its suite
listens on a reserved port and fetches, and it asserts the trade the recipe states: a
real asset answers `200` with its content type, and a missing one answers Bun's own
bare `404` rather than Problem Details.
```

- [ ] **Step 8: Run the gates and commit**

```bash
bun run check --fix
bun test ./examples/files/test/*.e2e-spec.ts
bun run test:examples
git add examples/files docs/files.md
git commit -m "docs(files): state the static-asset trade and measure the native half"
```

---

## Whole-branch verification

After Task 4, on the branch as a whole:

```bash
bun run check
bun run test:coverage
bun run test:vite-plus
bun run test:examples
bun run release:dry-run
bun run build
find packages -name '*.d.ts' -path '*/src/*' -delete
bun run test:generated-app
```

`test:coverage` is the lane that fails first if `download-file.ts` is imported but
never exercised: `scripts/coverage-gate.ts` discovers it by glob and requires it in
LCOV, and the floor is 95% line and function coverage. `release:dry-run` is required
because a published package's contents change — the barrel gains an export.

Then the Documentation and Ownership checks the guard suite already covers:

```bash
bun test scripts/
rg -nP '[\x{0E00}-\x{0E7F}]' --glob '!node_modules/**' --glob '!dist/**' .
```

## What this plan does not do

- **No push and no version bump.** Both are the push's business, and a push to a
  release branch publishes every package.
- **No scope-list edits.** `README.md`'s and `AGENTS.md`'s implemented and
  not-implemented lists belong to the batch delivery document, which names the
  configuration and logging-seam documents as the two that move them.
- **No `@UploadedFile()`.** The spec rejects the decorator (`:463-472`) and this plan
  does not revive it: `@Body("file")` already selects one part.
- **No framework static server, and no installed plugin.** The recipe names both
  paths; the plugin half stays prose because neither `@elysia/static` nor
  `@elysiajs/static` is installed and this change installs neither.
