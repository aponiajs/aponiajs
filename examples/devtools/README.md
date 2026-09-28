# Devtools

The opt-in surface that reports what a running application actually is. `src/main.ts`
mounts `devtoolsPlugin` through the factory's `plugins` option and hands it the same
logger object the factory gets, which is what makes `/__devtools/logs` carry the boot's
own lines.

## Run

```bash
bun run example:devtools
```

The application listens on `PORT`, defaulting to `3110`. The surface binds
`127.0.0.1:3111` unless `DEVTOOLS_PORT` names another port, and `ENABLE_DEVTOOLS=false`
mounts nothing at all — no provider, no plugin, no socket.

| Endpoint               | Answers                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/__devtools/meta`     | The contract version, this framework's release, the Elysia it ran, and which artifacts the boot adopted                                                                    |
| `/__devtools/graph`    | The module graph the boot compiled                                                                                                                                         |
| `/__devtools/routes`   | Every mounted route with the binding that serves it                                                                                                                        |
| `/__devtools/flow`     | The stages each route passes through, in order                                                                                                                             |
| `/__devtools/logs`     | The application's log stream, through the one logger both places were handed                                                                                               |
| `/__devtools/requests` | What each request was and what answered it                                                                                                                                 |
| `/__devtools/aot`      | What a build decided about this project's invokers — the boot's own record alone when no build wrote an analysis, which is this example's case and says so in its `reason` |

## Test

```bash
bun run --cwd examples/devtools test
```

`test/devtools.e2e-spec.ts` boots the real module with the surface mounted, reserving
both ports from the operating system so the lane never binds a fixed one, and reads each
endpoint over HTTP. It asserts the contract and the versions, the compiled graph, the
route table's binding, the stages of one route, a request the application answered with
its status, the boot's own line in `/logs`, the degraded half of `/aot`, and that a
disabled registration serves nothing.
