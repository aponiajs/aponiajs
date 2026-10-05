# @aponiajs/core

[![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcore)](https://www.npmjs.com/package/@aponiajs/core)

```bash
bun add @aponiajs/core @aponiajs/common
```

The Aponia dependency injection and module runtime:

- deterministic module graph compilation with actionable diagnostic hints;
- explicit module imports and provider exports;
- global modules (`@Global()`) providing app-wide visible providers;
- value, factory, class, and alias providers;
- full provider lifetimes (`Scope.DEFAULT`, `Scope.REQUEST`, `Scope.TRANSIENT`);
- circular dependency resolution via `forwardRef()`;
- stable diagnostics for invalid graphs, dependency cycles, and scope hierarchy.

Most HTTP applications receive this package through
`@aponiajs/platform-elysia`. Install it directly when building a platform
adapter or using the container without HTTP.

[npm package](https://www.npmjs.com/package/@aponiajs/core) ·
[complete package catalog](../../docs/packages.md)
