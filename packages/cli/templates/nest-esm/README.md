# {{PROJECT_NAME}}

An AponiaJS application generated with the Nest-compatible ESM template set.

```bash
bun run start:dev
```

`aponia-cli.json` names the `@aponiajs/schematics` collection and the source
root. `aponia build` runs this project's `build` script; `aponia start` runs
`src/main.ts` under Bun.

Relative imports carry the `.js` extension, as an ESM TypeScript project
requires. The Bun-first default (`aponia new <name>`) is the template set that
uses `.ts` extensions and `bun test` instead.
