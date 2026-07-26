# Benchmarks

AponiaJS benchmarks are reproducible diagnostics, not universal performance
claims. Results depend on the CPU, operating system, Bun version, power mode,
background load, and benchmark duration.

## Elysia request overhead

The Elysia overhead benchmark compares:

1. **Pure Elysia** — a direct Elysia route.
2. **Aponia native** — the same response through an Aponia-registered
   controller, dispatched by the underlying Elysia application.
3. **Aponia wrapper** — the same registered route through
   `AponiaElysiaApplication.handle()`.

It also compares direct Elysia application creation with
`AponiaFactory.create()`. Startup is reported separately because module graph
and dependency-container initialization happen once rather than on every
request.

Run the standard local profile:

```bash
bun run benchmark:elysia
```

The profile runs six independent trials. Trial order rotates deterministically,
so every implementation occupies each position equally and no implementation
always benefits from running first or last.

Use shorter durations and fewer trials for a smoke run:

```bash
APONIA_BENCH_REQUEST_MS=100 \
APONIA_BENCH_STARTUP_MS=50 \
APONIA_BENCH_ROUNDS=2 \
APONIA_BENCH_WARMUP_SAMPLES=2 \
APONIA_BENCH_MIN_SAMPLES=5 \
bun run benchmark:elysia
```

Each run writes ignored local output for inspection:

- `.benchmark-output/elysia-overhead.json` with raw summary statistics and
  environment metadata;
- `.benchmark-output/elysia-overhead.svg` with a Vega-rendered report.

These files are not committed and are not used by the repository README. The
public report always comes from the benchmark executed by GitHub Actions.

The report keeps throughput as the primary visual comparison and includes a
compact evidence grid with request `p50`, `p95`, and `p99`, startup `p50`,
coefficient of variation (`CV%`), and measured iterations. Lower latency and CV
are better; a lower CV indicates more stable trial-to-trial results.

The JSON retains every independent trial, execution order, tool version,
environment metadata, and the native-registration diagnostic. The chart
compares the public Aponia wrapper with pure Elysia, while the additional
diagnostic remains available for deeper analysis.

## Methodology

The benchmark uses [Mitata](https://github.com/evanwashere/mitata), the
microbenchmark tool recommended by
[Bun's benchmarking guide](https://bun.sh/docs/project/benchmarking). Mitata
provides high-resolution timing, automatic batching, warmup, garbage-collection
control, and raw samples. `simple-statistics` calculates interpolated
percentiles and cross-trial medians instead of relying on handwritten
statistical utilities.

Each implementation performs identical work and is validated before timing.
The request benchmark consumes the complete response body and checks the same
HTTP status and body. Startup trials create fresh applications, and every
Aponia instance is closed within its trial. Results are summarized as the
median across independent trials because the median is less sensitive to a
single noisy run than the arithmetic mean. Automatic operation batching is
disabled so `p50`, `p95`, and `p99` describe individual timed iterations rather
than averages of large batches.

## Continuous integration

The `Elysia overhead` job in the existing `CI` GitHub Actions workflow runs on
every pull request, every push, and manual dispatches. It installs the frozen
lockfile, pins Bun 1.3.14, builds the workspace once, and runs every
implementation on the same runner in the same process. CI runs six
order-balanced trials with longer per-case measurement time. The JSON and SVG
reports are retained as workflow artifacts for 14 days.

After a successful push to `main`, the same job publishes `.benchmark-output`
directly to the orphan `benchmark-results` branch. The repository README loads
the SVG from that stable branch with the workspace version as a cache key:

- [Latest CI chart](https://raw.githubusercontent.com/aponiajs/aponiajs/benchmark-results/elysia-overhead.svg?v=0.3.19)
- [Latest CI JSON](https://raw.githubusercontent.com/aponiajs/aponiajs/benchmark-results/elysia-overhead.json?v=0.3.19)

Pull requests still generate and upload their own reports for review, but they
cannot replace the public result. Publishing uses the workflow-scoped GitHub
token and only grants write access to the benchmark job.

CI does not enforce a fixed performance threshold. GitHub-hosted runners are
shared infrastructure, so their absolute timings fluctuate. The workflow
instead provides a consistent comparison environment and preserves each report
for review; functional mismatches and benchmark failures still fail the job.

For serious before/after analysis, compare repeated runs from the same runner
class and inspect both the delta and CV. Run locally on an otherwise idle
machine with a fixed power profile. Do not compare absolute values produced on
different hardware.

This is an in-process dispatch microbenchmark using each application's
`handle()` method. It intentionally excludes sockets, HTTP parsing, network
latency, and external load-generator overhead, so it isolates framework
dispatch costs rather than predicting production request rates. Use a dedicated
HTTP load generator and a representative application for capacity planning.
