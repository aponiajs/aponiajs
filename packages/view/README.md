# @aponiajs/view

High-performance template view engine and rendering pipeline for AponiaJS MVC applications.

## Installation

```bash
bun add @aponiajs/view@beta
```

## Usage

```ts
import { Module } from "@aponiajs/common";
import { ViewModule } from "@aponiajs/view";

@Module({
  imports: [ViewModule.register({ defaultEngine: "html" })],
})
export class AppModule {}
```
