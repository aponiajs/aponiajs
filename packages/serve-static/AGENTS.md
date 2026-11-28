# @aponiajs/serve-static — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

Nest-compatible `ServeStaticModule` (`forRoot` / `forRootAsync`) implemented via
`@aponiajs/common`'s `RequestLifecycleHook` and `resolveStaticAssetPath` so static
files and SPA fallbacks work identically on Elysia, Hono, and H3.
