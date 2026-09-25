import { generateInvokers } from "../generation/invoker-generator.ts";
import { generateProject } from "../generation/project-generator.ts";
import { generateSchematic } from "../generation/schematic-generator.ts";
import { aponiaVersion } from "../version.ts";
import { parseArguments } from "./arguments.ts";
import { helpText } from "./help-text.ts";
import type { DeclinedDescriptor } from "../generation/descriptor-emitter.types.ts";

/**
 * One line per declaration a build could not lower.
 *
 * A decline is not a change line, so it reads differently on purpose: the build
 * succeeded, and what it names is the source that has to change before the next
 * one can generate it.
 */
function describeDecline(decline: DeclinedDescriptor): string {
  return decline.kind === "module"
    ? `DECLINED module ${decline.module}: ${decline.reason}`
    : `DECLINED route ${decline.module}.${decline.controller}.${decline.method}: ${decline.reason}`;
}

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

    if (command.command === "build") {
      const result = await generateInvokers(command);
      for (const change of result.changes) {
        console.log(`${change.kind} ${change.path}`);
      }
      for (const decline of result.declined) {
        console.log(describeDecline(decline));
      }
      if (!result.dryRun) {
        console.log(
          "Next: import it in your entrypoint and pass its controllerInvokers to AponiaFactory.create.",
        );
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
