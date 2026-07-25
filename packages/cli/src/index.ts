import { parseArguments } from "./arguments.ts";
import { generateProject } from "./project-generator.ts";

export { parseArguments, type CliCommand } from "./arguments.ts";
export {
  generateProject,
  type GenerateProjectOptions,
  type GenerateProjectResult,
} from "./project-generator.ts";

export async function runCli(arguments_: readonly string[]): Promise<number> {
  try {
    const command = parseArguments(arguments_);

    if (command.command === "help") {
      console.log(helpText);
      return 0;
    }

    if (command.command === "version") {
      console.log("0.0.0");
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

Options:
  -d, --dry-run       Report files without writing them
  -s, --skip-install  Generate without running bun install
  -h, --help          Show command help
  -v, --version       Show CLI version
`;
