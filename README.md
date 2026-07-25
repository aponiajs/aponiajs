<div align="center">

<img
  src="./assets/aponia-debugging-chibi.webp"
  alt="AponiaJS"
  width="680"
/>

# AponiaJS

Bun-first TypeScript application framework built on Elysia.

**Experimental. Not ready for production.**

</div>

## Packages

| Package                     | Role                                       |
| --------------------------- | ------------------------------------------ |
| `@aponiajs/common`          | Decorators, contracts, tokens, and logging |
| `@aponiajs/core`            | Module graph and dependency injection      |
| `@aponiajs/platform-elysia` | Elysia integration                         |
| `@aponiajs/cli`             | Project generator                          |
| `create-aponia`             | `bun create` entry point                   |
| `aponiajs`                  | Public facade (planned)                    |

The packages currently use version `0.0.0` and are not published for production
use.

## Run the Example

Requires Bun `1.3.14` and Vite+ `0.2.x`.

```bash
vp install
bun run example:basic
```

```bash
curl http://localhost:3000/greetings
```

```text
Hello, AponiaJS!
```

## Generate a Project

```bash
bun packages/cli/bin/aponia.ts new my-api --skip-install
```

Preview without writing files:

```bash
bun packages/cli/bin/aponia.ts n my-api --dry-run
```

`--skip-install` is required while the workspace packages remain unpublished.

## Development

```bash
vp check
bun test
vp test
bun run build
```

## Documentation

- [Architecture](./docs/architecture-and-style.md)
- [CLI](./docs/cli.md)
- [Logging](./docs/logging.md)
- [Package roadmap](./plans/npm-package-architecture-roadmap.md)
- [Repository guidelines](./AGENTS.md)

## License

MIT

The project name and artwork reference Aponia from _Honkai Impact 3rd_.
AponiaJS is an independent project and is not affiliated with HoYoverse or
miHoYo.
