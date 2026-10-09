import {
  AponiaFactory,
  type AponiaApplication,
  type ElysiaApplication,
} from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";
import type { AppModuleDescriptor } from "../src/descriptors.generated.ts";

export type App = ElysiaApplication<typeof AppModuleDescriptor>;

export function createApplication(): Promise<AponiaApplication> {
  return AponiaFactory.create(AppModule, { logger: false });
}
