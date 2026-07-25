<div align="center">

<img
  src="./assets/aponia-header-minimal.webp"
  alt="AponiaJS"
  width="760"
/>

# AponiaJS

Bun-first TypeScript framework built on Elysia.

**Experimental**

</div>

## Create a Project

```bash
bun create aponia my-api
```

Run the example from this repository:

```bash
vp install
bun run example:basic
```

## Packages

| Package                                                                                | Role                             |
| -------------------------------------------------------------------------------------- | -------------------------------- |
| [`@aponiajs/common`](https://www.npmjs.com/package/@aponiajs/common)                   | Decorators and shared types      |
| [`@aponiajs/core`](https://www.npmjs.com/package/@aponiajs/core)                       | Modules and dependency injection |
| [`@aponiajs/platform-elysia`](https://www.npmjs.com/package/@aponiajs/platform-elysia) | Elysia integration               |
| [`@aponiajs/cli`](https://www.npmjs.com/package/@aponiajs/cli)                         | Project generator                |
| [`create-aponia`](https://www.npmjs.com/package/create-aponia)                         | `bun create` entry point         |

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
- [Releasing](./docs/releasing.md)
- [Repository guidelines](./AGENTS.md)

## License

MIT

AponiaJS is an independent project and is not affiliated with HoYoverse or
miHoYo.
