import { AponiaFactory, type AponiaApplication } from "@aponiajs/platform-elysia";
import { AppModule } from "../src/app.module.ts";
import { moduleDescriptorArtifact } from "../src/descriptors.generated.ts";
import type { App } from "../src/main.ts";

export function createApplication(): Promise<AponiaApplication<App>> {
  return AponiaFactory.create(AppModule, {
    logger: false,
    descriptors: moduleDescriptorArtifact,
  }) as unknown as Promise<AponiaApplication<App>>;
}
