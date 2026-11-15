# example-hono

An Aponia application booted onto the Hono platform.

```bash
bun run example:hono
```

`src/main.ts` boots `AppModule` with `@aponiajs/platform-hono`, mounts every route
under `/api`, and starts Bun's server. `test/hono.e2e-spec.ts` boots the same
module and answers a request through the native Hono application.
