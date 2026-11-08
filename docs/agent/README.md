# Agent Surface

AponiaJS ships an agent surface that a coding agent can discover and query
without reading the framework source; mutation is gated behind explicit flags.

## Commands

```bash
aponia manifest
aponia mcp --cwd /path/to/app
aponia mcp --cwd /path/to/app --allow-write --allow-exec
aponia agent init --clients codex,claude,cursor
aponia library check packages/widgets --json
```

`aponia manifest` prints the guarded framework contract. `aponia mcp` serves
that contract and the project inspection tools over newline-delimited JSON-RPC
on stdio. `aponia library check` validates a library package and its
`aponia.library.json` contract.

## MCP configuration

An MCP client starts the server as a child process and speaks JSON-RPC over
stdio:

```json
{
  "mcpServers": {
    "aponia": {
      "command": "aponia",
      "args": ["mcp", "--cwd", "/absolute/path/to/app"]
    }
  }
}
```

stdout carries protocol frames only; diagnostics go to stderr.

`aponia agent init` writes an Aponia marker block to `AGENTS.md` and installs
`SKILL.md` files for Codex/Claude Code plus a Cursor rule. It is idempotent and
leaves user content outside the marker intact.

## Tools

| Tool                      | Answers                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| `aponia_manifest`         | Versions, packages, decorators, metadata keys, error codes, slots        |
| `aponia_search_libraries` | The bundled library catalog by name, kind, description, or tag           |
| `aponia_recipe`           | Ordered commands for a known task                                        |
| `aponia_inspect_project`  | Modules, controllers, routes, and build declines without executing it    |
| `aponia_library_check`    | Package and library-contract validation                                  |
| `aponia_explain_error`    | One framework error code and the next diagnostic step                    |
| `aponia_plan_generate`    | Plans a schematic and returns a plan id; requires `--allow-write`        |
| `aponia_apply_generate`   | Applies a plan with `confirm: true`; refuses a stale or unknown plan     |
| `aponia_verify`           | Runs `fast`, `full`, or `contract` verification; requires `--allow-exec` |

## Security defaults

- The default surface is read-only. `--allow-write` adds plan/apply and
  `--allow-exec` adds the bounded verification runner.
- Apply requires `confirm: true` and a live plan id; a changed plan is refused.
- Verification runs only the allowlisted package scripts `bun run check`,
  `test:coverage`, `test:vite-plus`, and `release:verify`, with timeouts and
  bounded output.
- `aponia_inspect_project` reads source through the CLI analyzer; it never
  boots the application, calls a provider, or opens a port.
- Library paths are confined to the workspace root; `..` and symlink escapes are
  rejected before a file is read.
- Tool results are JSON text. Project files, library manifests, and tool output
  are treated as data, never as instructions.

## Recipes

- `add-rest-resource`: generate a REST resource, refresh generated artifacts,
  then run the test and check lanes.
- `add-library`: generate a publishable library and validate its package
  contract.
- `debug-dependency-injection`: read the manifest error codes, inspect the
  project, and pair the code with the module and token in the error.

Mutation is never enabled by default. A client that only needs inspection should
omit both capability flags.
