# {{PROJECT_NAME}}

`CLAUDE.md` and `GEMINI.md` are symlinks to this file.

This is an AponiaJS application in the Nest-compatible ESM template set:
Nest-style modules, controllers, and dependency injection running on Bun, with
Elysia as the HTTP layer. Relative imports end in `.js`, as ESM TypeScript
requires.

## Commands

```bash
bun run start        # start once
bun run start:dev    # start with file watching
bun test             # unit tests with Vitest
bun run test:e2e     # end-to-end tests through application.handle
bun run build        # compile into dist
bun run check        # type-check
```

Install the CLI once with `bun add --global @aponiajs/cli`, then use
`aponia generate` to add code. It renders the files and registers the new
declaration in the nearest module:

```bash
aponia generate resource users           # module, controller, service, and model
aponia generate resource chat --type ws  # provider-registered WebSocket gateway
aponia generate controller health --no-spec
aponia generate service users
aponia generate module billing
```

Prefer the generator over hand-written files so imports, suffixes, and module
registration match the rest of the project.

## Layout

```text
src/
|-- app.controller.spec.ts
|-- app.controller.ts
|-- app.module.ts
|-- app.service.ts
`-- main.ts
test/
`-- app.e2e-spec.ts
```

`src/main.ts` creates the application and listens on `PORT` (3000 by default).
`src/app.module.ts` is the root module; feature modules go in its `imports`.
Every later feature is a directory under `src/<resource>/`, holding its module,
controller, service, and tests together.

## Authoring rules

- Controllers declare routes with `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`,
  `@Head`, and `@Options`. Read request input through parameter decorators
  rather than reaching into the raw request.
- Controllers delegate to injectable services. Keep HTTP concerns in the
  controller and business behavior in the service.
- A provider is a singleton per module.
- Application failures return `HttpError` from `@aponiajs/platform-elysia`,
  which serializes as RFC 9457 `application/problem+json`.
- Import framework packages by their package name. Local imports carry the
  `.js` extension.

## Testing

Build the application with `AponiaFactory.create` and assert through
`application.handle(new Request(...))`. Pass `{ logger: false }` so bootstrap
does not print its route table.

See [`llms.txt`](./llms.txt) for the framework documentation and packages.
