export const helpText = `Aponia CLI

Usage:
  aponia new <name> [options]
  aponia n <name> [options]
  aponia generate <schematic> <name> [options]
  aponia g <schematic> <name> [options]
  aponia build [options]
  aponia library check [path] [options]
  aponia library search [query] [options]
  aponia manifest
  aponia mcp [options]
  aponia agent init [options]

Options:
  -d, --dry-run       Report files without writing them
  -s, --skip-install  Generate without running bun install
      --flat          Generate without a schematic directory
      --no-flat       Generate inside a schematic directory
      --spec          Generate spec files
      --no-spec       Skip spec files
      --skip-import   Skip declaring module registration
      --module <name> Select the declaring module
      --path <path>   Override the configured source root
      --publish       Generate a publishable library package
      --json          Print a library check result as JSON
      --cwd <path>    Project root for the MCP server
      --allow-write   Enable MCP plan/apply generation
      --allow-exec    Enable bounded MCP verification
      --clients <list> Agent clients: codex,claude,cursor
  -p, --project       Select a configured project
      --type <type>   Select a resource transport
      --crud          Generate CRUD entry points (default)
      --no-crud       Generate a resource without CRUD entry points
  -h, --help          Show command help
  -v, --version       Show CLI version

Schematics:
  app, library (lib), class (cl), controller (co), decorator (d),
  filter (f), gateway (ga), guard (gu), interface (itf),
  interceptor (itc), module (mo), provider (pr), resolver (r),
  resource (res), service (s)

Controller aliases:
  router, routers, route
`;
