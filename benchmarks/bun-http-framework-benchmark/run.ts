import { cpus } from "node:os";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const upstreamRepository = "https://github.com/SaltyAom/bun-http-framework-benchmark.git";
export const upstreamDefaultRef = "main";
export const selectedFrameworks = ["bun/aponia", "bun/elysia"] as const;

const repositoryRoot = resolve(import.meta.dir, "../..");
const workspacePath = join(repositoryRoot, ".benchmark-work/bun-http-framework-benchmark");
const outputRoot = join(repositoryRoot, ".benchmark-output");
const outputPath = join(outputRoot, "bun-http-framework-benchmark");
const adapterPath = join(import.meta.dir, "aponia.ts");

export function configureUpstreamRunner(source: string): string {
  const declaration = "const whitelists = <string[]>[]";
  const matches = source.split(declaration).length - 1;
  if (matches !== 1) {
    throw new Error(
      `Expected one upstream whitelist declaration but found ${matches}. Review the upstream runner before benchmarking.`,
    );
  }

  return source.replace(
    declaration,
    `const whitelists = <string[]>[${selectedFrameworks.map((name) => `'${name}'`).join(", ")}]`,
  );
}

export function configureElysiaControl(source: string): string {
  const route = ".get('/', 'Hi')";
  const matches = source.split(route).length - 1;
  if (matches !== 1) {
    throw new Error(
      `Expected one upstream Elysia ping route but found ${matches}. Review the upstream control before benchmarking.`,
    );
  }

  return source.replace(
    route,
    `.get('/', ({ set }) => {
		set.headers['content-type'] = 'text/plain'
		return 'Hi'
	})`,
  );
}

export function validateBenchmarkRun(summary: string, transcript: string): void {
  for (const framework of ["aponia", "elysia"]) {
    if (!summary.includes(`| ${framework} | bun |`)) {
      throw new Error(`Upstream results are missing the ${framework} treatment.`);
    }
  }

  const statusBlocks = transcript.match(/HTTP codes:[\s\S]*?Throughput:/g) ?? [];
  if (statusBlocks.length !== selectedFrameworks.length * 3) {
    throw new Error(`Expected six Bombardier HTTP status blocks but found ${statusBlocks.length}.`);
  }
  for (const [index, block] of statusBlocks.entries()) {
    if (
      !/2xx - [1-9]\d*/.test(block) ||
      !/4xx - 0/.test(block) ||
      !/5xx - 0/.test(block) ||
      !/others - 0/.test(block)
    ) {
      throw new Error(`Bombardier workload ${index + 1} contains unsuccessful responses.`);
    }
  }
}

export async function runBenchmark(): Promise<void> {
  const requestedRef = Bun.env.APONIA_BENCHMARK_UPSTREAM_REF ?? upstreamDefaultRef;
  const bombardierPath = Bun.which("bombardier");
  if (!bombardierPath) {
    throw new Error(
      "bombardier is required. Install it from https://github.com/codesenberg/bombardier before running the benchmark.",
    );
  }

  await rm(workspacePath, { recursive: true, force: true });
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(dirname(workspacePath), { recursive: true });

  try {
    await runCommand(["git", "clone", "--depth", "1", upstreamRepository, workspacePath]);
    if (requestedRef !== upstreamDefaultRef) {
      await runCommand(["git", "fetch", "--depth", "1", "origin", requestedRef], workspacePath);
      await runCommand(["git", "checkout", "--detach", "FETCH_HEAD"], workspacePath);
    }

    const upstreamRunnerPath = join(workspacePath, "bench.ts");
    const upstreamRunner = await Bun.file(upstreamRunnerPath).text();
    await Bun.write(upstreamRunnerPath, configureUpstreamRunner(upstreamRunner));
    const elysiaControlPath = join(workspacePath, "src/bun/elysia.ts");
    const elysiaControl = await Bun.file(elysiaControlPath).text();
    await Bun.write(elysiaControlPath, configureElysiaControl(elysiaControl));
    await cp(adapterPath, join(workspacePath, "src/bun/aponia.ts"));

    const upstreamCommit = (
      await captureCommand(["git", "rev-parse", "HEAD"], workspacePath)
    ).trim();
    const bombardierVersion = (
      await captureCommand([bombardierPath, "--version"], workspacePath)
    ).trim();

    const transcript = await runCommandWithTranscript(["bun", "bench.ts"], workspacePath);
    const summary = await Bun.file(join(workspacePath, "results/results.md")).text();
    validateBenchmarkRun(summary, transcript);
    await mkdir(outputPath, { recursive: true });
    await cp(join(workspacePath, "results"), join(outputPath, "results"), {
      recursive: true,
    });
    await Bun.write(join(outputPath, "benchmark.log"), transcript);
    await Bun.write(
      join(outputPath, "environment.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          measuredAt: new Date().toISOString(),
          study: "AponiaJS HTTP throughput under the bun-http-framework-benchmark protocol",
          upstream: {
            repository: upstreamRepository,
            requestedRef,
            commit: upstreamCommit,
          },
          runner: {
            name: "bombardier",
            version: Bun.env.APONIA_BENCHMARK_BOMBARDIER_VERSION ?? bombardierVersion,
            versionOutput: bombardierVersion,
            connections: 500,
            durationSecondsPerWorkload: 10,
          },
          environment: {
            runtime: `Bun ${Bun.version}`,
            platform: process.platform,
            architecture: process.arch,
            cpu: cpus()[0]?.model ?? "Unknown CPU",
            logicalCores: cpus().length,
            ci: Bun.env.CI === "true",
          },
          treatments: selectedFrameworks,
          workloads: ["GET /", "GET /id/1?name=bun", "POST /json"],
          primaryOutcome: "Average requests per second reported by Bombardier",
        },
        null,
        2,
      )}\n`,
    );

    console.log(`Raw benchmark data written to ${outputPath}`);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

async function runCommand(command: readonly string[], cwd = repositoryRoot): Promise<void> {
  const process = Bun.spawn([...command], {
    cwd,
    env: Bun.env,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`);
  }
}

async function captureCommand(command: readonly string[], cwd = repositoryRoot): Promise<string> {
  const process = Bun.spawn([...command], {
    cwd,
    env: Bun.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Command failed with exit code ${exitCode}: ${command.join(" ")}\n${stderr.trim()}`,
    );
  }
  return stdout || stderr;
}

async function runCommandWithTranscript(
  command: readonly string[],
  cwd = repositoryRoot,
): Promise<string> {
  const process = Bun.spawn([...command], {
    cwd,
    env: Bun.env,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  const transcript = `${stdout}${stderr}`;
  console.log(transcript);
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}: ${command.join(" ")}`);
  }
  return transcript;
}

if (import.meta.main) {
  await runBenchmark();
}
