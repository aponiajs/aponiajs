import { Module } from "@aponiajs/common";
import { ProvidersModule } from "./01-providers/providers.module.ts";
import { SettingsController } from "./01-providers/settings.controller.ts";
import { ValidationModule } from "./03-validation/validation.module.ts";
import { HttpMethodsModule } from "./04-http-methods/http-methods.module.ts";
import { RequestParametersModule } from "./05-request-parameters/request-parameters.module.ts";
import { NativePluginsModule } from "./06-native-plugins/native-plugins.module.ts";
import { metricsModule } from "./07-descriptors/metrics.descriptors.ts";

/**
 * The root module composes decorated feature modules, a hand-written descriptor
 * module, and native plugin modules into one graph.
 */
@Module({
  imports: [
    ProvidersModule,
    ValidationModule,
    HttpMethodsModule,
    RequestParametersModule,
    NativePluginsModule,
    metricsModule,
  ],
  controllers: [SettingsController],
})
export class AppModule {}
