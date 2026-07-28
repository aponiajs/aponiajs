# Multiple routers

Several controllers in one application. `ItemsController` owns `/items` and covers every HTTP method decorator; `HealthController` owns `/health`. Both resolve the same `CatalogService` singleton through a module import.

## Run

```bash
bun run example:multiple-routers
```

## Test

```bash
bun run --cwd examples/multiple-routers test
```

`test/routing.e2e-spec.ts` asserts each method, a lookup miss, an unmapped path, and that each router stays behind its own prefix.

[Every example](../README.md)
