# @aponiajs/common

[![npm](https://img.shields.io/npm/v/%40aponiajs%2Fcommon)](https://www.npmjs.com/package/@aponiajs/common)

Platform-neutral decorators and public contracts for Aponia modules,
controllers, routes, and dependency injection.

## Install

```bash
bun add @aponiajs/common
```

## Public surface

The public application authoring API includes `@Module()`, `@Controller()`,
HTTP method decorators, `@Injectable()`, and `@Inject()`. This package does not
depend on Elysia, Bun runtime APIs, or another Aponia package.

```ts
import { Controller, Get, Injectable, Module } from "@aponiajs/common";

@Injectable()
class GreetingService {
  greet(): string {
    return "Hello!";
  }
}

@Controller("greetings")
class GreetingController {
  constructor(private readonly greetings: GreetingService) {}

  @Get()
  getGreeting(): string {
    return this.greetings.greet();
  }
}

@Module({
  controllers: [GreetingController],
  providers: [GreetingService],
})
export class GreetingModule {}
```

[npm package](https://www.npmjs.com/package/@aponiajs/common) ·
[complete package catalog](../../docs/packages.md)
