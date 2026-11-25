export const helpText = `Aponia CLI

Usage:
  aponia new <name> [options]
  aponia n <name> [options]
  aponia generate <schematic> <name> [options]
  aponia g <schematic> <name> [options]
  aponia update [options]
  aponia build [project] [options]
  aponia start [app|entry] [options]
  aponia info [options]
  aponia add <package> [options]
  aponia dev [entry] [options]
  aponia library check [path] [options]
  aponia library new <name> [options]
  aponia library publish [path] [options]
  aponia library search [query] [options]
  aponia manifest
  aponia agent init [options]

Configuration:
  aponia-cli.json   The Nest-shaped project configuration (aponia.json is
                    accepted once with a deprecation warning)

new options:
      --directory <dir>          Destination directory
      --type <bun|esm|cjs>       Module system and template set (default bun)
      --test-runner <runner>     bun, vitest, or jest (bun for --type bun)
      --minimal                  Generate the single-file starter
      --package-manager <pm>     bun, npm, pnpm, or yarn
      --language <ts|js>         Source language; only ts is emitted
      --strict / --no-strict     TypeScript strict mode (default on)
      --collection <package>     Schematic collection
      --observe / --no-observe   Preconfigure the devtools surface
      --skills <list>            Agent clients: codex,claude,cursor,all
      --skip-skills              Skip installing agent guidance
      --skip-git                 Skip git init
      --skip-install, -s         Generate without installing
      --dry-run, -d              Report files without writing them

generate options:
      --flat / --no-flat         Generate without a schematic directory
      --spec / --no-spec         Generate spec files
      --spec-file-suffix <name>  Spec file suffix (default spec)
      --module <name>            Select the declaring module
      --path <path>              Override the configured source root
      --project, -p <name>       Select a configured project
      --language <ts|js>         Source language; only ts is emitted
      --strict / --no-strict     TypeScript strict mode
      --collection <package>     Schematic collection
      --skip-import              Skip declaring module registration
      --no-interactive           Never prompt for missing values
      --dry-run, -d              Report files without writing them
  resource:
      --type <transport>         rest, graphql, microservice, or ws
      --crud / --no-crud         CRUD entry points (default on)

build options:
      --path <path>              Project directory to build
      --watch                    Rebuild on change
      --builder <tsc|swc>        Supported builders (default tsc)
      --tsc / --swc              Short forms of --builder
      --webpack / --rspack       Refused by name
      --type-check / --no-type-check
      --emit-declarations
      --all                      Build every configured project
      --project, -p <name>       Select a configured project
      --config <file>            Configuration file to read
      --dry-run, -d              Report the build command without running it

start options:
      --watch                    Run under Bun's watcher
      --debug                    Run with Bun's inspector
      --exec <command>           Executable (default from aponia-cli.json)
      --path <file>              Explicit file to run
      --project, -p <name>       Select a configured project
      --config <file>            Configuration file to read

add options:
      --skip-install, -s         Skip the package manager after the schematic
      --dry-run, -d              Report files without writing them

Schematics:
  application, sub-app (app), library (lib), configuration (config),
  plugin (pl), mcp, class (cl), controller (co), decorator (d), filter (f),
  gateway (ga), guard (gu), interface (itf), interceptor (itc),
  middleware (mi), module (mo), pipe (pi), provider (pr), resolver (r),
  resource (res), service (s), upgrade (update)

Controller aliases:
  router, routers, route

  -h, --help                  Show command help
  -v, --version               Show CLI version
`;
