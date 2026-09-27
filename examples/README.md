# Examples

One runnable application per topic. Each directory is named after what it
demonstrates, boots on its own port, and ships end-to-end tests that assert the
behavior the framework promises.

| Example                | Demonstrates                                                                             | Port | Command                                |
| ---------------------- | ---------------------------------------------------------------------------------------- | ---- | -------------------------------------- |
| `basic`                | A minimal application with a feature module, plus lifecycle and logging                  | 3000 | `bun run example:basic`                |
| `multiple-routers`     | Several controllers, path prefixes, every HTTP method decorator                          | 3010 | `bun run example:multiple-routers`     |
| `dependency-injection` | Every provider kind, tokens, visibility, and graph failures                              | 3020 | `bun run example:dependency-injection` |
| `validation`           | One-schema model classes over Standard Schema and native validation                      | 3030 | `bun run example:validation`           |
| `request-parameters`   | Named, whole, and absent parameter decorators over input, cookies, request, and response | 3040 | `bun run example:request-parameters`   |
| `native-plugins`       | Native Elysia plugins mounted, deduplicated, and typed                                   | 3050 | `bun run example:native-plugins`       |
| `descriptors`          | The same framework with no decorators at all                                             | 3060 | `bun run example:descriptors`          |
| `websockets`           | Nest-style gateways backed by native Elysia WebSockets                                   | 3070 | `bun run example:websockets`           |
| `files`                | Uploads through the body slot, named downloads, and static assets                        | 3080 | `bun run example:files`                |

Run every suite the way CI does:

```bash
bun run test:examples
```

Each example keeps the same shape: `src/app.module.ts` composes it, `src/main.ts`
bootstraps it, `test/application.ts` holds the request helpers, and
`test/*.e2e-spec.ts` asserts the topic.
