# Benchmarks

AponiaJS benchmarks are reproducible diagnostics, not universal performance
claims. Results depend on the CPU, operating system, Bun version, background
load, and benchmark duration.

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

Run the full benchmark:

```bash
bun run benchmark:elysia
```

Use shorter durations for a smoke run:

```bash
APONIA_BENCH_REQUEST_MS=250 \
APONIA_BENCH_STARTUP_MS=150 \
APONIA_BENCH_WARMUP_MS=50 \
bun run benchmark:elysia
```

Each run updates:

- `.ecc/benchmarks/elysia-overhead.json` with raw summary statistics and
  environment metadata;
- `assets/benchmarks/elysia-overhead.svg` with a Vega-rendered report.

## Continuous integration

The `Benchmark` GitHub Actions workflow runs on every pull request, every push
to `main`, and manual dispatches. It installs the frozen lockfile, pins Bun
1.3.14, builds the workspace once, and runs every implementation on the same
runner in the same process. The JSON and SVG reports are retained as workflow
artifacts for 14 days.

CI does not enforce a fixed performance threshold. GitHub-hosted runners are
shared infrastructure, so their absolute timings fluctuate. The workflow
instead provides a consistent comparison environment and preserves each report
for review; functional mismatches and benchmark failures still fail the job.

The request benchmark consumes the response body and validates identical HTTP
status and body values before measuring. Tinybench performs warmup and
statistical sampling. Run on an otherwise idle machine, use the same power
profile, and compare results produced on equivalent hardware.

This is an in-process dispatch microbenchmark using each application's
`handle()` method. It intentionally excludes sockets, HTTP parsing, network
latency, and external load-generator overhead, so it isolates framework
dispatch costs rather than predicting production request rates.
