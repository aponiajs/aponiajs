# Reference

The catalog, the frozen surface, and the policies that answer what ships, what
is supported, and what a reader can depend on. Read this category to look up a
package or export rather than to learn a workflow.

## When to read what

| Page                                           | Answers                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| [Packages](./packages.md)                      | The package catalog, the npm split, and what each package provides             |
| [API reference](./api.md)                      | Every name each published package exports from its barrel                      |
| [Feature status](./feature-status.md)          | Per-package completeness and the known gaps outside the current release        |
| [Stability and the public API](./stability.md) | The frozen snapshot, compatibility, change classes, and the deprecation policy |
| [Support and release lifetime](./support.md)   | Supported channels, fix windows, response targets, and what support covers     |
| [Threat model](./threat-model.md)              | Trust boundaries, the control behind each threat, and residual risks           |

## Start here

Read [Packages](./packages.md) for what npm serves today, then
[stability and the public API](./stability.md) before depending on an export.
The [API reference](./api.md) is generated from `docs/public-api.json`; refresh
it with `bun run docs:api` after the snapshot changes.

Return to the [documentation index](../README.md).
