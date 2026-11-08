import { formatBuildReport } from "../generation/build-report.ts";
import { generateInvokers } from "../generation/invoker-generator.ts";
import { generateProject } from "../generation/project-generator.ts";
import { generateSchematic } from "../generation/schematic-generator.ts";
import { checkLibrary } from "../library/check-library.ts";
import { searchLibraries } from "../library/catalog.ts";
import { frameworkContract } from "../contracts/framework-contract.ts";
import { createAgentMcpServer } from "../agent/mcp-server.ts";
import { serveMcpStdio } from "../agent/mcp-stdio.ts";
import { initAgent } from "../agent/init-agent.ts";
import { aponiaVersion } from "../version.ts";
import { parseArguments } from "./arguments.ts";
import { helpText } from "./help-text.ts";

/**
 * Runs the CLI from parsed arguments to printed change lines.
 *
 * Prints `CREATE`/`UPDATE` lines and returns an exit code — it never throws.
 * A generation failure rejects the build rather than reporting and skipping.
 *
 * @param arguments_ - The raw command-line arguments, without the binary name.
 * @returns The process exit code: `0` on success, non-zero on failure.
 *
 * @example
 * ```ts
 * const code = await runCli(["generate", "controller", "users"]);
 * ```
 */
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
      for (const line of formatBuildReport(result)) {
        console.log(line);
      }
      if (!result.dryRun) {
        console.log(
          "Next: import it in your entrypoint and pass its controllerInvokers to AponiaFactory.create.",
        );
      }
      return 0;
    }

    if (command.command === "library") {
      if (command.action === "search") {
        const entries = searchLibraries(command.query);
        if (command.json) {
          console.log(JSON.stringify(entries));
        } else if (entries.length === 0) {
          console.log("No libraries matched.");
        } else {
          for (const entry of entries) {
            console.log(`${entry.name} [${entry.kind}] — ${entry.description}`);
          }
        }
        return 0;
      }
      const result = await checkLibrary({
        path: command.path,
        publish: command.publish,
      });
      if (command.json) {
        console.log(JSON.stringify(result));
      } else if (result.ok) {
        console.log(`Library is valid: ${result.directory}`);
      } else {
        console.log(`Library check failed: ${result.directory}`);
        for (const issue of result.issues) {
          console.log(`  - ${issue}`);
        }
      }
      return result.ok ? 0 : 1;
    }

    if (command.command === "manifest") {
      console.log(JSON.stringify(frameworkContract, undefined, 2));
      return 0;
    }

    if (command.command === "mcp") {
      await serveMcpStdio(
        createAgentMcpServer({
          cwd: command.cwd,
          project: command.project,
          allowWrite: command.allowWrite === true,
          allowExec: command.allowExec === true,
        }),
      );
      return 0;
    }

    if (command.command === "agent") {
      const result = await initAgent({
        cwd: command.cwd,
        clients: command.clients,
        dryRun: command.dryRun,
      });
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
