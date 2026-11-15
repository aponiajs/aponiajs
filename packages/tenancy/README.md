# @aponiajs/tenancy

Request-scoped multi-tenancy for AponiaJS.

```bash
bun add @aponiajs/tenancy@alpha
```

```ts
import { Module } from "@aponiajs/common";
import { TenantModule } from "@aponiajs/tenancy";

@Module({ imports: [TenantModule.register({ header: "x-tenant-id" })] })
export class AppModule {}
```

```ts
@Controller("users")
@UseGuards(TenantGuard)
export class UsersController {
  constructor(private readonly tenant: TenantService) {}

  @Get()
  list() {
    return this.tenant.require();
  }
}
```

## Behavior

- `TenantGuard` resolves from a `resolver`, a verified `principal` claim, then an
  explicitly configured `header`, in that order.
- A registration must provide at least one source; otherwise it fails with
  `INVALID_TENANCY_OPTIONS`.
- The header is opt-in and is selection, not authorization; bind the tenant to a
  verified principal when the application authenticates requests.
- A missing tenant answers `400` when `required` is true (the default).
- A tenant id must match the configured safe pattern; the default accepts 1-128
  characters from `A-Za-z0-9._:-`.
- `TenantService.current()` reads the request tenant; `require()` fails with
  `MISSING_TENANT` when none is selected, and the default boundary answers `400`.

The package resolves a tenant identifier. It does not store tenants, scope a
database connection, or enforce repository filters; those are application or
database-package responsibilities.

## Bootstrap

```ts
import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModule } from "./app.module.ts";

const application = await AponiaFactory.create(AppModule);
await application.listen(Number(Bun.env.PORT ?? 3000));
```

## Documentation

- [Tenancy guide](../../docs/tenancy.md)
- [Published packages](../../docs/packages.md)
- [npm](https://www.npmjs.com/package/@aponiajs/tenancy)
