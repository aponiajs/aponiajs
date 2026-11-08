/**
 * Measures the framework's own dispatch path: `application.handle` without a
 * listening server, so the number describes routing, validation hooks, and
 * handler invocation rather than the kernel's socket stack.
 *
 * ```bash
 * bun run bench
 * BENCH_ITERATIONS=200000 bun run bench
 * ```
 */
import { defineModule } from "@aponiajs/common";
import { AponiaFactory, controller } from "@aponiajs/platform-elysia";

class BenchController {
  text(): string {
    return "ok";
  }

  json(): { readonly ok: boolean } {
    return { ok: true };
  }
}

const benchController = controller(BenchController, [], (application, instance) =>
  application.get("/bench/text", () => instance.text()).get("/bench/json", () => instance.json()),
);

const AppModule = defineModule({ id: "BenchmarkModule", controllers: [benchController] });

const iterations = readIterations(Bun.env.BENCH_ITERATIONS);
const warmup = Math.min(2_000, iterations);

const application = await AponiaFactory.create(AppModule, { logger: false });
try {
  // A green run has to prove dispatch happened, not only that a Response came back.
  const probe = await application.handle(request("/bench/text"));
  if ((await probe.text()) !== "ok" || probe.status !== 200) {
    throw new Error("The benchmark route did not answer its handler result.");
  }
  const missing = await application.handle(request("/bench/missing"));
  if (missing.status !== 404) {
    throw new Error("The benchmark missing route did not answer 404.");
  }

  const scenarios = [
    { label: "GET /bench/text", path: "/bench/text" },
    { label: "GET /bench/json", path: "/bench/json" },
    { label: "GET /bench/missing (404)", path: "/bench/missing" },
  ];
  const report: string[] = [];

  for (const scenario of scenarios) {
    for (let index = 0; index < warmup; index += 1) {
      await application.handle(request(scenario.path));
    }
    const started = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      await application.handle(request(scenario.path));
    }
    const elapsedMs = performance.now() - started;
    const perSecond = Math.round((iterations / elapsedMs) * 1_000);
    const micros = ((elapsedMs * 1_000) / iterations).toFixed(2);
    report.push(
      `${scenario.label.padEnd(28)} ${String(perSecond).padStart(9)} req/s   ${micros.padStart(8)} µs/req`,
    );
  }

  console.log(`AponiaJS dispatch benchmark — ${iterations} iterations per scenario`);
  console.log("application.handle, no network, Bun " + Bun.version);
  console.log("");
  for (const line of report) {
    console.log(line);
  }
} finally {
  await application.close();
}

function request(path: string): Request {
  return new Request(`http://localhost${path}`);
}

function readIterations(value: string | undefined): number {
  const parsed = Number(value ?? 25_000);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 25_000;
}
