# @aponiajs/mvc — Agent Guide

Read the [repository guide](../../AGENTS.md) and [RULES.md](../../RULES.md) first.

## What this package owns

The Inertia protocol for React and Vue. Server-side Blade rendering belongs to `@aponiajs/view`, and delivery adapters belong to their own packages.

`src/index.ts` is the only public barrel. Every response is a standard Web `Response`, which keeps the protocol working on every delivery adapter.
