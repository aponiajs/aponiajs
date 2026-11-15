# @aponiajs/h3 — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This guide covers only this adapter.

## What this package owns

The runtime envelope translation around `@aponiajs/serverless`. It does not own
routing, dependency injection, guards, validation, or filters; those remain in
the Aponia application behind `application.handle`.

`src/index.ts` is the only public barrel.

## Invariants

- Keep the adapter thin. Do not add a second route table, container, or guard pipeline.
- Preserve the runtime request and response unchanged; only the envelope is translated.
- Import `toFetchHandler` from `@aponiajs/serverless` rather than duplicating it.
- A runtime dependency must remain a peer, so an application that never mounts
  this adapter does not install the runtime through it.
- WebSockets are not emulated here.

## Tests

Bun tests exercise the adapter through the runtime's own request path, plus a
Vite+ conformance test for the public contract.
