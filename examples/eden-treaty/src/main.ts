import { AponiaFactory } from "@aponiajs/platform-elysia";
import { AppModuleDescriptor } from "./descriptors.generated.ts";

export const app = await AponiaFactory.createNative(AppModuleDescriptor);
export type App = typeof app;

if (import.meta.main) {
  app.listen(3120);
}
