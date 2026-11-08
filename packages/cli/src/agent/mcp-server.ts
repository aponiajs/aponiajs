import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { AgentMcpServer, defineAgentTool } from "./mcp-protocol.ts";
import { aponiaVersion } from "../version.ts";
import { frameworkContract } from "../contracts/framework-contract.ts";
import { analyzeBuildProject } from "../generation/build-project-analysis.ts";
import { checkLibrary } from "../library/check-library.ts";
import { searchLibraries } from "../library/catalog.ts";
import { generateSchematic } from "../generation/schematic-generator.ts";
import { schematicNames } from "../commands/command.constants.ts";
import type { GenerateSchematic, ResourceTransport } from "../commands/command.types.ts";
import type { GenerateSchematicOptions } from "../generation/schematic.types.ts";
import { runVerification, type VerificationScope } from "./verify.ts";

const recipes: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "add-rest-resource": [
    "aponia g res <name> --type rest",
    "aponia build",
    "bun test",
    "bun run check",
  ],
  "add-library": [
    "aponia g library <name> --publish",
    "aponia library check packages/<name> --publish",
    "bun run --cwd packages/<name> build",
  ],
  "debug-dependency-injection": [
    "Call aponia_manifest and read errorCodes.",
    "Call aponia_inspect_project and read the module/controller/decline lists.",
    "Pair the diagnostic code with the module and token named in the error.",
  ],
});

/** Options the project-scoped MCP server accepts. */
export interface AgentMcpServerOptions {
  readonly cwd?: string;
  readonly project?: string;
  readonly allowWrite?: boolean;
  readonly allowExec?: boolean;
}

/** Creates the secure, read-only MCP surface an agent connects to. */
export function createAgentMcpServer(options: AgentMcpServerOptions = {}): AgentMcpServer {
  const server = new AgentMcpServer({ name: "aponia", version: aponiaVersion });
  const root = resolve(options.cwd ?? process.cwd());
  const plans = new Map<
    string,
    { readonly options: GenerateSchematicOptions; readonly hash: string }
  >();

  server.registerTool(
    defineAgentTool({
      name: "aponia_manifest",
      description:
        "Returns the framework contract: versions, packages, decorators, metadata keys, error codes, route slots, schematics, lifecycle hooks, and versioning strategies.",
      inputSchema: { type: "object", properties: {} },
      handler: () => textResult(frameworkContract),
    }),
  );

  server.registerTool(
    defineAgentTool<{ query?: string }>({
      name: "aponia_search_libraries",
      description: "Searches the bundled library catalog by name, kind, description, or tag.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional case-insensitive search text." },
        },
      },
      handler: ({ query }) => textResult(searchLibraries(query ?? "")),
    }),
  );

  server.registerTool(
    defineAgentTool<{ topic: string }>({
      name: "aponia_recipe",
      description: "Returns the ordered commands for a known AponiaJS task.",
      inputSchema: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "add-rest-resource, add-library, or debug-dependency-injection",
          },
        },
        required: ["topic"],
      },
      handler: ({ topic }) => {
        const steps = recipes[topic];
        return steps === undefined
          ? errorResult(`Unknown recipe "${topic}".`)
          : textResult({ topic, steps });
      },
    }),
  );

  server.registerTool(
    defineAgentTool({
      name: "aponia_inspect_project",
      description:
        "Reads module, controller, route, and decline facts from the project on disk without executing application code.",
      inputSchema: { type: "object", properties: {} },
      handler: async () => {
        try {
          const analysis = await analyzeBuildProject({ cwd: root, project: options.project });
          return textResult({
            projectRoot: analysis.projectRoot,
            sourceRoot: analysis.sourceRoot,
            modules: analysis.modules.map((module) => ({
              className: module.className,
              global: module.global === true,
              unreadable: module.unreadable,
            })),
            controllers: analysis.controllers.map((controller) => ({
              className: controller.className,
              path: controller.path,
              routes: controller.routes.map((route) => ({
                method: route.method,
                path: route.path,
                methodName: route.methodName,
                unreadable: route.unreadable,
              })),
            })),
            declined: analysis.descriptors.declined,
            invokerDeclines: analysis.invokers.declined,
          });
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : String(error));
        }
      },
    }),
  );

  server.registerTool(
    defineAgentTool<{ path: string; publish?: boolean }>({
      name: "aponia_library_check",
      description:
        "Validates a library package.json, aponia.library.json, public barrel, tests, and documentation without writing files.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Library directory inside the workspace root." },
          publish: { type: "boolean", description: "Require a publishable package." },
        },
        required: ["path"],
      },
      handler: async ({ path, publish }) => {
        const target = resolve(root, path);
        if (target !== root && !target.startsWith(`${root}${sep}`)) {
          return errorResult("The library path escapes the workspace root.");
        }
        try {
          return textResult(await checkLibrary({ cwd: root, path, publish: publish === true }));
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : String(error));
        }
      },
    }),
  );

  server.registerTool(
    defineAgentTool<{ code: string }>({
      name: "aponia_explain_error",
      description: "Explains one framework error code from the guarded contract.",
      inputSchema: {
        type: "object",
        properties: {
          code: { type: "string", description: "An AponiaErrorCode member." },
        },
        required: ["code"],
      },
      handler: ({ code }) => {
        if (!frameworkContract.errorCodes.includes(code)) {
          return errorResult(`Unknown framework error code "${code}".`);
        }
        return textResult({
          code,
          docs: "https://github.com/aponiajs/aponiajs#readme",
          hint: "Read the module, token, and issue details on the error, then run aponia_inspect_project.",
        });
      },
    }),
  );

  if (options.allowWrite === true) {
    server.registerTool(
      defineAgentTool<{
        schematic: string;
        name: string;
        type?: string;
        path?: string;
        module?: string;
        flat?: boolean;
        spec?: boolean;
        crud?: boolean;
      }>({
        name: "aponia_plan_generate",
        description:
          "Plans one schematic without writing files and returns a plan id the caller can apply.",
        inputSchema: {
          type: "object",
          properties: {
            schematic: { type: "string", description: "A schematic name from aponia_manifest." },
            name: { type: "string", description: "The component or resource name." },
            type: { type: "string", description: "Resource transport; defaults to rest." },
            path: { type: "string", description: "Output path inside the project." },
            module: { type: "string", description: "The declaring module." },
            flat: { type: "boolean" },
            spec: { type: "boolean" },
            crud: { type: "boolean" },
          },
          required: ["schematic", "name"],
        },
        handler: async (input) => {
          try {
            const planned = buildPlanOptions(root, input);
            const result = await generateSchematic(planned);
            const hash = planHash(root, planned, result.changes);
            plans.set(hash, { options: planned, hash });
            return textResult({ planId: hash, changes: result.changes });
          } catch (error) {
            return errorResult(error instanceof Error ? error.message : String(error));
          }
        },
      }),
    );

    server.registerTool(
      defineAgentTool<{ planId: string; confirm: boolean }>({
        name: "aponia_apply_generate",
        description:
          "Applies a previously planned generation after confirming the plan id; stale or missing plans are refused.",
        inputSchema: {
          type: "object",
          properties: {
            planId: { type: "string", description: "The id returned by aponia_plan_generate." },
            confirm: { type: "boolean", description: "Must be true to write files." },
          },
          required: ["planId", "confirm"],
        },
        handler: async ({ planId, confirm }) => {
          if (confirm !== true) {
            return errorResult("The apply step requires confirm: true.");
          }
          const plan = plans.get(planId);
          if (plan === undefined) {
            return errorResult("The plan id is unknown or already consumed.");
          }
          try {
            const fresh = await generateSchematic(plan.options);
            if (planHash(root, plan.options, fresh.changes) !== plan.hash) {
              return errorResult("STALE_PLAN: the plan changed before it was applied.");
            }
            const result = await generateSchematic({ ...plan.options, dryRun: false });
            plans.delete(planId);
            return textResult({ applied: true, changes: result.changes });
          } catch (error) {
            return errorResult(error instanceof Error ? error.message : String(error));
          }
        },
      }),
    );
  }

  if (options.allowExec === true) {
    server.registerTool(
      defineAgentTool<{ scope: string }>({
        name: "aponia_verify",
        description:
          "Runs one allowlisted verification scope (fast, full, or contract) and returns structured command results.",
        inputSchema: {
          type: "object",
          properties: {
            scope: {
              type: "string",
              description:
                "fast (check), full (check + coverage + Vite+), or contract (release verification)",
            },
          },
          required: ["scope"],
        },
        handler: async ({ scope }) => {
          if (scope !== "fast" && scope !== "full" && scope !== "contract") {
            return errorResult(`Unknown verification scope "${scope}".`);
          }
          try {
            return textResult(await runVerification(scope as VerificationScope, root));
          } catch (error) {
            return errorResult(error instanceof Error ? error.message : String(error));
          }
        },
      }),
    );
  }

  return server;
}

interface PlanInput {
  readonly schematic: string;
  readonly name: string;
  readonly type?: string;
  readonly path?: string;
  readonly module?: string;
  readonly flat?: boolean;
  readonly spec?: boolean;
  readonly crud?: boolean;
}

function buildPlanOptions(root: string, input: PlanInput): GenerateSchematicOptions {
  if (!schematicNames.includes(input.schematic as GenerateSchematic)) {
    throw new Error(`Unknown schematic "${input.schematic}".`);
  }
  const type = input.type ?? "rest";
  if (
    !["rest", "graphql-code-first", "graphql-schema-first", "microservice", "ws"].includes(type)
  ) {
    throw new Error(`Unknown resource transport "${type}".`);
  }
  return {
    command: "generate",
    schematic: input.schematic as GenerateSchematic,
    name: input.name,
    dryRun: true,
    skipImport: false,
    crud: input.crud ?? true,
    type: type as ResourceTransport,
    ...(input.path === undefined ? {} : { path: input.path }),
    ...(input.module === undefined ? {} : { module: input.module }),
    ...(input.flat === undefined ? {} : { flat: input.flat }),
    ...(input.spec === undefined ? {} : { spec: input.spec }),
    cwd: root,
  };
}

function planHash(
  root: string,
  options: GenerateSchematicOptions,
  changes: readonly { readonly path: string; readonly kind: string }[],
): string {
  return createHash("sha256").update(JSON.stringify({ root, options, changes })).digest("hex");
}

function textResult(value: unknown): {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
} {
  return Object.freeze({
    content: Object.freeze([
      Object.freeze({ type: "text" as const, text: JSON.stringify(value, null, 2) }),
    ]),
  });
}

function errorResult(message: string): {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly isError: true;
} {
  return Object.freeze({
    content: Object.freeze([Object.freeze({ type: "text" as const, text: message })]),
    isError: true as const,
  });
}
