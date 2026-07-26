# HTTP Benchmark Research Protocol

## Abstract

This study measures AponiaJS HTTP throughput relative to Elysia under the
standard protocol maintained by
[`SaltyAom/bun-http-framework-benchmark`](https://github.com/SaltyAom/bun-http-framework-benchmark).
It publishes raw text and environment metadata rather than generated charts.
The purpose is reproducible comparison under controlled conditions, not a
universal ranking or a production-capacity claim.

## Research question

How many requests per second does an Aponia application complete relative to a
direct Elysia application when both implement the same upstream workloads on
the same Bun runtime and machine?

The direct Elysia implementation is the control treatment. The Aponia adapter
is the experimental treatment. Average requests per second reported by
Bombardier is the primary outcome.

## Experimental design

The upstream `main` branch is cloned at the start of each run. Its exact commit
is recorded in `environment.json`. Aponia contributes one adapter at
`src/bun/aponia.ts`. The integration adds an explicit plain-text header to the
upstream Elysia ping route because current Elysia releases no longer infer that
header for the original static-string declaration. Route behavior and timed
work remain unchanged. The runner is configured to execute only these two Bun
treatments.

| Controlled variable    | Value                                   |
| ---------------------- | --------------------------------------- |
| Runtime                | Same Bun executable for both treatments |
| Port                   | `3000`                                  |
| Load generator         | Bombardier with `fasthttp`              |
| Concurrent connections | `500`                                   |
| Duration               | `10 seconds` per workload               |
| Process model          | One framework server at a time          |
| Environment            | `NODE_ENV=production`                   |

The upstream runner validates response bodies, content types, and the required
`x-powered-by` header before measurement. A treatment that fails validation is
excluded rather than assigned a throughput value.

## Workloads

| Workload | Request              | Required behavior                                            |
| -------- | -------------------- | ------------------------------------------------------------ |
| Ping     | `GET /`              | Return `Hi` as plain text                                    |
| Query    | `GET /id/1?name=bun` | Dynamically return `1 bun` and set `x-powered-by: benchmark` |
| Body     | `POST /json`         | Parse and serialize `{ "hello": "world" }` as JSON           |

The Aponia adapter also tests query extraction with reordered or absent
parameters so the measured route cannot rely on a hard-coded URL index.

## Procedure

Install Bombardier and workspace dependencies, then run:

```bash
go install github.com/codesenberg/bombardier@v1.2.6
bun install
bun run benchmark:upstream
```

Set `APONIA_BENCHMARK_UPSTREAM_REF` to a commit when reproducing a historical
run:

```bash
APONIA_BENCHMARK_UPSTREAM_REF=<commit> bun run benchmark:upstream
```

The command builds the workspace, clones the upstream suite into an ignored
working directory, injects the Aponia adapter, executes the upstream runner,
copies the raw results, records the environment, and removes the temporary
clone.

## Raw data

Each run writes only text and JSON under
`.benchmark-output/bun-http-framework-benchmark/`:

- `results/results.md`: upstream requests-per-second table;
- `results/bun/aponia.txt`: upstream requests-per-second captures for Aponia;
- `results/bun/elysia.txt`: upstream requests-per-second captures for Elysia;
- `benchmark.log`: complete upstream and Bombardier console transcript;
- `environment.json`: runtime, hardware, runner, workload, and upstream commit
  metadata.

CI publishes the same files after a successful push to `main`:

- [Raw comparison table](https://raw.githubusercontent.com/aponiajs/aponiajs/benchmark-results/bun-http-framework-benchmark/results/results.md?v=0.3.21)
- [Raw Aponia output](https://raw.githubusercontent.com/aponiajs/aponiajs/benchmark-results/bun-http-framework-benchmark/results/bun/aponia.txt?v=0.3.21)
- [Experimental environment](https://raw.githubusercontent.com/aponiajs/aponiajs/benchmark-results/bun-http-framework-benchmark/environment.json?v=0.3.21)

Pull-request runs retain their raw files as workflow artifacts for 14 days but
cannot replace the public dataset.

## Interpretation

Compare Aponia and Elysia only within the same `results/results.md` file.
Differences across machines, runner images, Bun versions, upstream commits, or
background load are confounded and should not be treated as framework effects.
The three workload values are reported independently; their arithmetic average
is a descriptive summary, not a confidence interval.

## Limitations

The protocol uses one timed observation per workload and treatment, so it does
not estimate sampling uncertainty or support significance testing. GitHub
hosted runners use shared infrastructure and may vary between runs. The
workloads are intentionally small, omit application I/O, and measure synthetic
maximum throughput. They do not predict latency, tail behavior, memory use, or
capacity for a production application.

CI rejects a run when either treatment is absent or any timed workload reports
non-2xx responses. This integrity gate prevents an incomplete table from being
published as a valid comparison.
