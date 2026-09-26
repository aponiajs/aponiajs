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
- **Loopback only.** When the server lands it binds `127.0.0.1` on `port`
  (default `8000`), with no way to widen the address.

## Documentation

- [Published packages](../../docs/packages.md): the npm catalog and install
  commands.
- [Repository guide](../../AGENTS.md): how the framework is organized.
