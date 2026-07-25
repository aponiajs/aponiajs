# @aponiajs/core

The initial Aponia runtime foundation:

- deterministic module graph compilation;
- explicit module imports and provider exports;
- value, factory, class, and alias providers;
- singleton dependency resolution without decorators or reflection;
- stable diagnostics for invalid graphs and dependency cycles.

Async providers, request scope, lifecycle hooks, HTTP, and Elysia integration are
intentionally outside this first implementation.
