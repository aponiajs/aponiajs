# example-h3

An Aponia application booted onto the H3 platform.

```bash
bun run example:h3
```

`src/main.ts` boots `AppModule` with `@aponiajs/platform-h3`, mounts every route
under `/api`, and starts Bun's server. `test/h3.e2e-spec.ts` boots the same
module and answers a request through the native H3 application.
