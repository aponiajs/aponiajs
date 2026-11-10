# @aponiajs/mvc — Agent Guide

Read the [repository guide](../../AGENTS.md) and [RULES.md](../../RULES.md) first.

## What this package owns

The Inertia protocol for React, Vue, and Svelte, and the framework delivery bridges. The view rendering itself belongs to `@aponiajs/view`.

`src/index.ts` is the only public barrel. Every response is a standard Web `Response`, which is what keeps the protocol working on every delivery adapter.
