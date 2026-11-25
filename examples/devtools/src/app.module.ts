import { Module, type ModuleClass } from "@aponiajs/common";
import { DevtoolsModule, type DevtoolsOptions } from "@aponiajs/devtools";
import { AppController } from "./app.controller.ts";
import { AppService } from "./app.service.ts";

/** What a boot of this example decides about its own devtools surface. */
export interface AppModuleOptions {
  readonly devtools: DevtoolsOptions;
}

/**
 * Builds the example application with one devtools registration.
 *
 * The options are an argument rather than a module-level constant because
 * `enabled` and the logger are per-boot decisions: the end-to-end case boots the
 * same source twice, once with the surface on and once off. The class keeps the
 * `AppModule` name so the boot record and `/__devtools/graph` report the root the
 * example names.
 */
export function createAppModule(options: AppModuleOptions): ModuleClass {
  @Module({
    imports: [DevtoolsModule.forRoot(options.devtools)],
    controllers: [AppController],
    providers: [AppService],
  })
  class AppModule {}

  return AppModule;
}
