# Provenance

The collection shape, the per-schematic `schema.json` files, and the template
sets under `src/lib/<schematic>/files/` were copied from these upstream
releases at execution time:

| Package              | Version   | Git commit                                 |
| -------------------- | --------- | ------------------------------------------ |
| `@nestjs/schematics` | `12.0.16` | `f65144f448d56f0a3f979335bf48606ffc7d79ee` |
| `@nestjs/cli`        | `12.0.15` | `32eaf76c7de0f8fbb63d4a313d5109c0308c1115` |

The `@nestjs/cli` release is the source of the verified configuration defaults
in `aponia-cli.json` (`lib/configuration/defaults.js`). The `@nestjs/schematics`
release is the source of `collection.json`, every `schema.json`, and the
template files.

Deviations from the upstream copies:

- Template files carry a `.tmpl` suffix so the placeholder syntax never reaches
  the repository's type-check, lint, or format lanes.
- `configuration` renders `aponia-cli.json` rather than `nest-cli.json`, and
  states the Aponia defaults; the upstream file only creates the CLI file.
- The `upgrade` factory plans no files: the CLI owns the manifest rewrite and
  install, because both need the workspace's version resolution.
- The application templates remain the upstream Nest starter copies. The
  Aponia CLI renders its own Bun-first starter from
  `packages/cli/templates/application`; this collection is the compatibility
  surface. The same holds for the component templates: the built-in
  `aponia generate` path renders Aponia-native sources from the CLI's own
  renderers, and the collection's factories render the pinned upstream copies.
