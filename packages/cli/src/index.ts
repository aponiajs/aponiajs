import { parseArguments } from "./arguments.ts";
import { generateProject } from "./project-generator.ts";
import { generateSchematic } from "./schematic-generator.ts";
import { aponiaVersion } from "./version.ts";

export {
  generateSchematics,
  parseArguments,
  type CliCommand,
  type GenerateCommandOptions,
  type GenerateSchematic,
  type ResourceTransport,
} from "./arguments.ts";
export {
  generateProject,
  type GenerateProjectOptions,
  type GenerateProjectResult,
} from "./project-generator.ts";
export {
  generateSchematic,
  type GenerateSchematicOptions,
  type GenerateSchematicResult,
  type SchematicChange,
} from "./schematic-generator.ts";

export async function runCli(arguments_: readonly string[]): Promise<number> {
  try {
    const command = parseArguments(arguments_);

    if (command.command === "help") {
      console.log(helpText);
      return 0;
    }

    if (command.command === "version") {
      console.log(aponiaVersion);
      return 0;
    }

    if (command.command === "generate") {
      const result = await generateSchematic(command);
      for (const change of result.changes) {
        console.log(`${change.kind} ${change.path}`);
      }
      return 0;
    }

    const result = await generateProject(command);
    if (result.dryRun) {
      console.log(`CREATE ${result.projectDirectory}`);
      for (const file of result.files) {
        console.log(`  ${file}`);
      }
      return 0;
    }

    console.log(`Created ${command.name}`);
    console.log(`Next: cd ${command.name} && bun run dev`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Aponia CLI error: ${message}`);
    return 1;
  }
}

const helpText = `Aponia CLI

Usage:
  aponia new <name> [options]
  aponia n <name> [options]
  aponia generate <schematic> <name> [options]
  aponia g <schematic> <name> [options]

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
  -p, --project       Select a configured project
      --type <type>   Select a resource transport
      --crud          Generate CRUD entry points (default)
      --no-crud       Generate a resource without CRUD entry points
  -h, --help          Show command help
  -v, --version       Show CLI version

Schematics:
  app, library (lib), class (cl), controller (co), decorator (d),
  filter (f), gateway (ga), guard (gu), interface (itf),
  interceptor (itc), middleware (mi), module (mo), pipe (pi),
  provider (pr), resolver (r), resource (res), service (s)

Controller aliases:
  router, routers, route
`;
