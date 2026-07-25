# Basic foundation example

This executable HTTP example composes the Aponia foundation packages:

- `@aponiajs/common` defines tokens, providers, and modules;
- `@aponiajs/core` compiles the module graph and resolves singleton services.
- `@aponiajs/platform-elysia` discovers controllers and mounts native Elysia
  route plugins.

## Structure

```text
src/
|-- app.module.ts
|-- main.ts
`-- greeting/
    |-- greeting.controller.spec.ts
    |-- greeting.controller.ts
    |-- greeting.module.ts
    `-- greeting.service.ts
test/
`-- app.e2e-spec.ts
```

## Run

From the repository root:

```bash
bun run example:basic
```

Then request the controller route:

```bash
curl http://localhost:3000/greetings
```

The request flows through `GreetingModule`, `GreetingController`, and
`GreetingService`. `main.ts` only creates and listens to the application.
