# @aponiajs/core

[![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcore)](https://www.npmjs.com/package/@aponiajs/core)

```bash
bun add @aponiajs/core @aponiajs/common
```

The initial Aponia runtime foundation:

- deterministic module graph compilation;
- explicit module imports and provider exports;
- value, factory, class, and alias providers;
- singleton dependency resolution without decorators or reflection;
- stable diagnostics for invalid graphs and dependency cycles.

Async providers, request scope, lifecycle hooks, HTTP, and Elysia integration are
intentionally outside this first implementation.

Most HTTP applications receive this package through
`@aponiajs/platform-elysia`. Install it directly when building a platform
adapter or using the container without HTTP.

[npm package](https://www.npmjs.com/package/@aponiajs/core) ·
[complete package catalog](../../docs/packages.md)
