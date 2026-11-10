# Inertia Vue Example

A Vue 3 Inertia page served by an Aponia controller.

## Run

```bash
bun run example:inertia-vue
```

## Test

```bash
bun run --cwd examples/inertia-vue test:e2e
```

The test verifies both the first-load HTML payload and the `X-Inertia` JSON navigation response, then bundles the Vue client entry.
