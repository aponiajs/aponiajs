# Views and Inertia

AponiaJS serves views two ways. `@aponiajs/view` renders server-side Blade templates. `@aponiajs/mvc` answers the Inertia protocol so a React, Vue, or Svelte component receives the page props the controller returns.

Both produce a standard Web `Response`, so the same controller answers through Elysia, Hono, H3, Nitro, Web Fetch, AWS Lambda, Express, or Fastify.

## Blade views

```ts
import { Module } from "@aponiajs/common";
import { ViewModule } from "@aponiajs/view";

@Module({
  imports: [
    ViewModule.register({
      defaultEngine: "blade",
      rootDir: new URL("./views", import.meta.url).pathname,
      shared: { appName: "Orders" },
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
    return { title: "Users", users: [{ name: "Ada" }] };
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

A template name uses dots as directories: `users.index` resolves `views/users/index.html`. The engine also accepts `.blade.html` and `.php`.

### Directives

| Directive                                  | Meaning                                                      |
| ------------------------------------------ | ------------------------------------------------------------ |
| `@extends('layouts.app')`                  | Renders this template inside a layout                        |
| `@section('name') ... @endsection`         | Defines a named block                                        |
| `@yield('name', 'fallback')`               | Prints a block                                               |
| `@include('partials.nav', { key: value })` | Renders another template with extra data                     |
| `<x-alert type="info">slot</x-alert>`      | Renders `views/components/alert.html` with `type` and `slot` |
| `{{ value }}`                              | Escaped output                                               |
| `{!! value !!}`                            | Raw output                                                   |
| `@if(expr) ... @else ... @endif`           | Conditional                                                  |
| `@foreach(items as item) ... @endforeach`  | Loop                                                         |

Components receive `slot` for their inner markup and every declared prop. A bound prop uses a colon: `:count="users.length"`.

Templates and compiled expressions are cached in memory. The first render reads the file and compiles each expression once.

## Inertia pages

```ts
import { Controller, Get } from "@aponiajs/common";
import { Inertia } from "@aponiajs/mvc";

@Controller("users")
export class UsersController {
  @Get()
  @Inertia("Users/Index")
  index() {
    return { users: [{ id: "1", name: "Ada" }] };
  }
}
```

An ordinary request receives a root document with the page payload in `#app`, using the same shape `@inertiajs/react` and `@inertiajs/vue3` expect:

```html
<div id="app" data-page='{"component":"Users/Index",...}'></div>
```

A request carrying `X-Inertia: true` receives the page object as JSON with `X-Inertia: true` and `Vary: X-Inertia`. That is the client-side navigation path, so a React or Vue page updates without a full reload.

The handler's return value becomes the page props. `@Inertia` registers a response serializer, which is why the route works on every delivery adapter without an adapter-specific branch.

Use `inertia(component, props, context)` when a handler wants to build the response itself.

## Adapters

The view stack is adapter-neutral. The tests boot one Blade view and one Inertia page and answer them through:

- native Elysia
- Web Fetch
- Hono
- H3
- Nitro
- AWS Lambda payload 2.0

The framework packages that ride the request pipeline — auth, cache, idempotency, rate limiting, security, session, tenancy, and the rest — answer through `application.handle`, which is the same request every adapter forwards.

## Security

`{{ value }}` escapes HTML. `{!! value !!}` is the explicit raw escape hatch; use it only for markup the application produced. Blade expressions are developer-authored, not user input, and are cached functions. Never build a template from a request value.
