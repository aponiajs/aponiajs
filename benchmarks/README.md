# Benchmarks

`bun run bench` measures the framework's dispatch path through
`application.handle`: routing, route hooks, and handler invocation, with no
listening socket. It warms each scenario, then reports requests per second and
microseconds per request for a text route, a JSON route, and a `404`.

```bash
bun run bench
BENCH_ITERATIONS=200000 bun run bench
```

## What the numbers mean

The harness measures this process on this machine. It exists to catch a
regression between two commits and to show where a change spends time, not to
rank AponiaJS against another framework: a "hello world" comparison across
frameworks measures the harness as much as the framework.

The scenarios are deliberately small — no body parsing, no validation schema, no
authentication — because those are layers an application opts into. A route that
declares a schema or a guard costs more, and that cost belongs to the feature,
not to the baseline.

## Running it in CI

The benchmark is a script, not a gate: timings differ between runners, and a
wall-clock threshold would fail for reasons unrelated to the change. Run it
before and after a performance change and compare the same machine.
