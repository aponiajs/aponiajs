# Files

A file is an ordinary body value: Elysia parses the multipart request, `t.File()`
validates the part, and `@Body()` hands the handler the platform's own `File`. The
example measures every working shape and the one that refuses — `t.File()` as the
whole body — because that boundary is the one a reader reaches for first.

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

## Downloads

Two routes answer with the same file: one as an attachment under its own name, one
inline under a name outside ASCII, which is percent-encoded per RFC 8187 rather than
reaching the engine raw. `test/downloads.e2e-spec.ts` asserts both the header and the
bytes.

## Static assets

`public/` is served under `/assets/*` by a Bun native directory route, mounted through
`configureNative`. Because that route is composed when the server starts, its suite
listens on a reserved port and fetches, and it asserts the trade the recipe states: a
real asset answers `200` with its content type, and a missing one answers Bun's own
bare `404` rather than Problem Details.

[Every example](../README.md)
