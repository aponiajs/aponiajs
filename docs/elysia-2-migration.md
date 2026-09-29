# Elysia 2 migration work in progress

This branch is a migration draft, not an Elysia 2-compatible release. The
supported peer dependency and workspace installations remain on Elysia 1.4.
Do not publish or merge this draft as a completed dependency upgrade.

## Implemented preparation

The platform's single native route-registration boundary recognizes the
candidate `method(method, path, hook, handler)` ABI when `route()` is absent.
It preserves the receiver and the original handler and schema objects, supplies
an empty hook when no schema is declared, and does not catch or retry a native
registration failure. The existing `route(method, path, handler, hook)` path
remains authoritative when it is present.

Mirrored Bun and Vite+ cases cover the argument order, receiver, empty schema,
legacy preference, original error propagation, and unsupported-capability
error. A method-to-legacy harness also checks that request validation survives
the argument-order adaptation. That harness runs on Elysia 1.4; it is explicitly
not evidence that an installed Elysia 2 runtime is compatible. These new tests
have not been executed in the authoring environment.

## Remaining release blockers

- Verify the published beta in the npm registry. The inspected upstream
  `kiana/package.json` identifies `2.0.0-beta.19`, but a moving source branch is
  not a substitute for verifying the published package and its declarations.
- Install and pin the same verified Elysia 2 beta in every workspace manifest,
  both platform/devtools peer dependencies, examples, and the CLI starter.
  Regenerate `bun.lock` with the repository's Bun 1.4.2 toolchain; do not edit
  package integrity hashes by hand.
- Migrate schema and context types, including the TypeBox dependency boundary,
  `SingletonBase`, and plugin derive/resolve inference. Preserve the
  platform-neutral common/core dependency direction.
- Migrate status-map and custom-status-response APIs, response settings,
  native lifecycle options, WebSocket registration, and devtools integrations.
  Validate every native import against the actual published beta exports.
- Update native plugin examples, generated descriptor/invoker version stamps,
  both test lanes, the affected package README, and compatibility/owner guides.
- Run the synchronized alpha version bump and its release verification. No
  release version bump has been performed in this draft.
- Run `bun run check`, `bun run test:coverage`, `bun run test:vite-plus`,
  `bun run test:examples`, `bun run build`, `bun run test:generated-app`, and
  `bun run release:dry-run`. Preserve the 95% coverage gate and frozen installs.

## Authoring environment

The current environment has no Bun executable and cannot resolve external
package or GitHub download hosts. An attempt to add a temporary validation
workflow was blocked, and that workflow was not created. No build, test,
package installation, or lockfile regeneration is reported as successful.

See [Elysia compatibility](elysia-compatibility.md) for the currently supported
release contract.
