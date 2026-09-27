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

[Every example](../README.md)
