# Inertia React Example

A React Inertia page served by an Aponia controller.

## Run

```bash
bun run example:inertia-react
```

## Test

```bash
bun run --cwd examples/inertia-react test:e2e
```

The test verifies both the first-load HTML payload and the `X-Inertia` JSON navigation response, then bundles the React client entry.
