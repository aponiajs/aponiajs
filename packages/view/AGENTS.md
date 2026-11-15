# @aponiajs/view — Agent Guide

Read the [repository guide](../../AGENTS.md) and [RULES.md](../../RULES.md) first.

## What this package owns

The Laravel-style template engines and the view module that provides `VIEW_ENGINE`.

| Domain     | Owns                                            |
| ---------- | ----------------------------------------------- |
| `engines/` | `HtmlViewEngine` and `BladeViewEngine`          |
| `module/`  | `ViewModule`, `ViewService`, and view contracts |

`src/index.ts` is the only public barrel. Blade templates are developer-authored; expression evaluation is cached and templates are cached in memory. Every render returns a string that the platform serves as `text/html; charset=utf-8`.
