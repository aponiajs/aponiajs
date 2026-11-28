# @aponiajs/view — Agent Guide

Read the [repository guide](../../AGENTS.md) and [RULES.md](../../RULES.md) first.

## What this package owns

The Laravel-style template engines and the view module that provides `VIEW_ENGINE`.

| Domain        | Owns                                                                 |
| ------------- | -------------------------------------------------------------------- |
| `engines/`    | `HtmlViewEngine` and `BladeViewEngine`                               |
| `helper/`     | The standalone `view()` response helper                              |
| `module/`     | `ViewModule`, `ViewService`, and the `.module-definition.ts` builder |
| `interfaces/` | the view-engine and module contracts                                 |

`src/index.ts` is the only public barrel. Blade templates are developer-authored;
expression evaluation is cached and templates are cached in memory. Every render
returns a string that the platform serves as `text/html; charset=utf-8`. The
registration is a `ConfigurableModuleBuilder` definition with
`MODULE_OPTIONS_TOKEN` (`VIEW_MODULE_OPTIONS`) and `isGlobal` (default true);
`register`/`registerAsync` remain as deprecated aliases.

- **Rendered data is not template source.** Capture every echoed value behind a
  per-render token and resolve the tokens once after composition. Never run a
  directive or echo pass over a rendered value, a section, or a layout string.
- **Both engines escape.** `HtmlViewEngine` escapes every value; `BladeViewEngine`
  escapes `{{ }}` and reserves `{!! !!}` for trusted markup.
