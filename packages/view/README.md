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
    ViewModule.register({
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

The engine caches template sources and compiled expressions in memory, so repeated renders do not parse or compile the same template again.
