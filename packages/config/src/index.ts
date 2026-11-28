export {
  CONFIG_MODULE_OPTIONS,
  CONFIGURATION_LOADER,
  CONFIGURATION_TOKEN,
  getConfigToken,
} from "./config.constants.ts";
export { ConfigModule } from "./config.module.ts";
export { ConfigService } from "./config.service.ts";
export { registerAs } from "./utils/register-as.ts";
export type {
  ConfigFactory,
  ConfigFactoryKeyHost,
  ConfigModuleAsyncOptions,
  ConfigModuleOptions,
  ConfigObject,
} from "./interfaces/config-module.interface.ts";
