# @aponiajs/view

Laravel-style view rendering for AponiaJS: Blade layouts, sections, components, slots, props, and dot-notation templates.

## Installation

```bash
bun add @aponiajs/view@alpha
```

## Usage

```ts
import { Module } from "@aponiajs/common";
import { ViewModule } from "@aponiajs/view";

@Module({
  imports: [
    ViewModule.forRoot({
      defaultEngine: "blade",
      rootDir: new URL("./views", import.meta.url).pathname,
      shared: { appName: "AponiaJS" },
    }),
  ],
})
export class AppModule {}
```

```ts
import { Controller, Get, Render } from "@aponiajs/common";

@Controller("users")
export class UsersController {
  @Get()
  @Render("users.index")
  index() {
    return { users: [{ name: "Ada" }] };
  }
}
```

`views/users/index.html`:

```html
@extends('layouts.app') @section('content')
<h1>{{ title }}</h1>
@include('partials.navbar')
<x-alert type="info">Total: {{ users.length }}</x-alert>
@foreach(users as user)
<li>{{ user.name }}</li>
@endforeach @endsection
```

## Supported syntax

- `@extends('layouts.app')`, `@section('name')...@endsection`, `@yield('name')`
- `@include('partials.nav', { key: value })`
- `<x-component-name prop="value" :bound="expression">slot</x-component-name>`
- `{{ escaped }}` and `{!! raw !!}`
- `@if(expression) ... @else ... @endif`, `@unless(...)`, and `@foreach(items as item)`
- Dot-notation lookup: `users.show` resolves `views/users/show.html`

The engine caches template sources and compiled expressions in memory, so repeated renders do not parse or compile the same template again. Values are captured during rendering and resolved once at the end, so a value containing Blade delimiters stays data rather than becoming a second template.

`HtmlViewEngine` escapes every interpolated value. It has no raw-output
syntax; use `fragment()` for trusted markup or select the Blade engine when a
template needs `{!! ... !!}`. Placeholder names are flat identifiers, so
`{{ user.name }}` renders literally; Blade is the engine that resolves nested
expression paths.

## Registration contract

`ViewModule.forRoot` is a `ConfigurableModuleBuilder` definition: it provides and
exports `MODULE_OPTIONS_TOKEN` (`VIEW_MODULE_OPTIONS`), is global by default
(`isGlobal: false` opts out), accepts the three asynchronous shapes through
`forRootAsync`, and keeps `register`/`registerAsync` as deprecated aliases.
`ViewService` and `VIEW_ENGINE` stay exported beside the module.
