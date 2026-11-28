# MVC & HTMX Example

Laravel-style MVC architecture in AponiaJS:

- **Model**: `src/articles/article.model.ts`
- **View**: Nested `src/articles/views/index.blade.html`
- **Controller**: `src/articles/articles.controller.ts` with clean `return view(...)`

## Run

```bash
bun run example:mvc
```

## Run Tests

```bash
bun run --cwd examples/mvc test:e2e
```
