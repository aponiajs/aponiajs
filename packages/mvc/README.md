# @aponiajs/mvc

Inertia component and prop protocol for React and Vue in AponiaJS.

## Installation

```bash
bun add @aponiajs/mvc@beta
```

## Pages

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

A normal request receives the root document with the page payload in `#app`, which hydrates a React or Vue component. A request with `X-Inertia: true` receives the page object as JSON, which is the client-side navigation path.

## Imperative helper

```ts
import { inertia } from "@aponiajs/mvc";
import { Context } from "@aponiajs/common";

@Get("users")
users(@Context() context: { request: Request }) {
  return inertia("Users/Index", { users: [] }, context);
}
```

The package answers with a standard Web `Response`, so the same handler works through any Aponia delivery adapter.
