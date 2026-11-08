# @aponiajs/tenancy

Request-scoped multi-tenancy for AponiaJS.

```bash
bun add @aponiajs/tenancy@beta
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

- `TenantGuard` reads the configured header or a custom `resolver`.
- A missing tenant answers `400` when `required` is true (the default).
- A tenant id must match the configured safe pattern; the default accepts 1-128
  characters from `A-Za-z0-9._:-`.
- `TenantService.current()` reads the request tenant; `require()` fails with
  `MISSING_TENANT` when none is selected.
- The resolver runs before the header, so an application can derive a tenant
  from an authenticated JWT claim.

The package resolves a tenant identifier. It does not store tenants, scope a
database connection, or enforce repository filters; those are application or
database-package responsibilities.

## Documentation

- [Tenancy guide](../../docs/tenancy.md)
- [Published packages](../../docs/packages.md)
- [npm](https://www.npmjs.com/package/@aponiajs/tenancy)
