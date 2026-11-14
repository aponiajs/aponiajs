# Views and HTML Templates

AponiaJS provides server-side Blade template rendering through `@aponiajs/view` with master layouts, sections, components, slots, shared data, and automatic HTMX integration.

Views produce a standard Web `Response` with `content-type: text/html; charset=utf-8`, so the same controller answers through native Elysia, Hono, H3, Nitro, Web Fetch, or AWS Lambda.

## Laravel-style MVC

Views live in co-located feature folders (for example, `src/articles/views/`) beside the controller, model, and service.

```ts
import { Module } from "@aponiajs/common";
import { ViewModule } from "@aponiajs/view";
import { ArticlesModule } from "./articles/articles.module.ts";

@Module({
  imports: [ViewModule.register({ defaultEngine: "blade" }), ArticlesModule],
})
export class AppModule {}
```

`src/articles/articles.controller.ts`:

```ts
import { Controller, Delete, Get, Param, Render } from "@aponiajs/common";
import { fragment, view } from "@aponiajs/view";
import { ArticlesService } from "./articles.service.ts";

@Controller("articles")
export class ArticlesController {
  constructor(private readonly service: ArticlesService) {}

  @Get()
  index() {
    const articles = this.service.findAll();
    return view("articles.views.index", { title: "Articles", articles });
  }

  @Get("decorated")
  @Render("articles.views.index")
  decorated() {
    const articles = this.service.findAll();
    return { title: "Articles", articles };
  }

  @Get(":id")
  show(@Param("id") id: string) {
    const article = this.service.findOne(id);
    return view("articles.views.detail", { article, title: article?.title ?? "Article" });
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    this.service.remove(id);
    return fragment("<p>Article deleted successfully</p>");
  }
}
```

`src/articles/views/index.blade.html`:

```html
@extends('layouts.app') @section('content')
<div id="articles-container">
  <h1>{{ title }}</h1>
  <ul>
    @foreach(articles as article)
    <li><a href="/articles/{{ article.id }}">{{ article.title }}</a></li>
    @endforeach
  </ul>
</div>
@endsection
```

A template name resolves dot-notation paths into directory structures: `articles.views.index` checks `src/articles/views/index.blade.html`, `src/articles/views/index.html`, and `views/`. The engine also accepts co-located relative paths like `./views/index.blade.html`.

## Automatic HTMX adaptation

When an incoming request carries the `HX-Request: true` header, the view renderer automatically strips the outer layout (`@extends`) and returns only the inner section content for immediate DOM swapping. No conditional logic is needed in the controller.

For small inline responses or action confirmations, use the `fragment()` helper:

```ts
@Delete(":id")
remove(@Param("id") id: string) {
  this.service.remove(id);
  return fragment("<p>Article deleted successfully</p>");
}
```

### Directives

| Directive                                  | Meaning                                             |
| ------------------------------------------ | --------------------------------------------------- |
| `@extends('layouts.app')`                  | Renders this template inside a layout               |
| `@section('name') ... @endsection`         | Defines a named block                               |
| `@yield('name', 'fallback')`               | Prints a block with an optional fallback            |
| `@include('partials.nav', { key: value })` | Renders another template with extra data            |
| `<x-alert type="info">slot</x-alert>`      | Renders `components/alert.html` with props and slot |
| `{{ value }}`                              | Escaped HTML output                                 |
| `{!! value !!}`                            | Raw unescaped output                                |
| `@if(expr) ... @else ... @endif`           | Conditional                                         |
| `@unless(expr) ... @endunless`             | Inverse conditional                                 |
| `@foreach(items as item) ... @endforeach`  | Loop                                                |

Templates and compiled expressions are cached in memory.

## Adapters

The view stack is adapter-neutral. Controllers rendering Blade views answer identically through:

- native Elysia
- Web Fetch
- Hono
- H3
- Nitro
- AWS Lambda payload 2.0

## Security

`{{ value }}` escapes HTML. `{!! value !!}` is an explicit escape hatch for trusted markup only. Blade expressions are developer-authored templates compiled into functions. Never construct template names from unvalidated user input.

## Runnable examples

- [Blade MVC](../examples/mvc): nested feature architecture with models, controllers, Blade views, auto-HTMX, and fragment helpers.
