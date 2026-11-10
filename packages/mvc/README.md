# @aponiajs/mvc

Laravel-style full-stack MVC for AponiaJS: Inertia component and prop protocol for React, Vue, or Svelte, plus delivery bridges for Next.js, Nuxt, Angular, Express, and Fastify.

## Installation

```bash
bun add @aponiajs/mvc@beta
```

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

## Delivery bridges

- `createNextHandler(nextApp)`: Next.js custom server bridge
- `createNuxtHandler(nuxtApp)`: Nuxt 3 Nitro renderer bridge
- `createAngularHandler(engine, options)`: Angular CommonEngine SSR bridge
- `toExpressHandler(application)`: Express middleware
- `toFastifyHandler(application)`: Fastify route handler
