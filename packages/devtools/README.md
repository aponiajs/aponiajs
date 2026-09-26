# @aponiajs/devtools

```bash
bun add @aponiajs/devtools
```

Opt-in devtools for a running Aponia application. The package is a leaf: nothing
in the framework depends on it, and an application installs it deliberately.

Registration is the opt-in, and `enabled` is the switch:

```ts
import { Module } from "@aponiajs/common";
import { DevtoolsModule } from "@aponiajs/devtools";

@Module({
  imports: [
    DevtoolsModule.register({
      enabled: Bun.env.NODE_ENV !== "production",
    }),
  ],
})
export class AppModule {}
```

- **Disabled mounts nothing.** A disabled registration is an inert module: no
  provider, no plugin, and no socket.
- **Enabled is a plugin, not a provider.** The devtools plugin runs at
  `onStart`, after every route has mounted, which is what lets it see the route
  table a boot-time provider cannot.
- **`onStart` requires `listen()`.** An application that only calls `handle()`
  publishes nothing and is otherwise unaffected.
- **Loopback only.** The devtools server binds `127.0.0.1` on `port` (default
  `8000`), with no way to widen the address.
- **A taken port never fails a boot.** The refused bind is reported under
  `Devtools`, and the application continues without the devtools server.
- **`GET /__devtools/meta` is the contract.** It answers the devtools contract
  version, the release that booted the application, the Elysia release it
  resolved, which release supplied each artifact the boot adopted, and when the
  server started. Every endpoint is a `GET`: any other method answers `405`, and
  an unknown path answers `404`.

```bash
curl http://127.0.0.1:8000/__devtools/meta
```

## Documentation

- [Published packages](../../docs/packages.md): the npm catalog and install
  commands.
- [Repository guide](../../AGENTS.md): how the framework is organized.
