import type { AnyElysia } from "elysia";
import type { AponiaRootModule } from "../modules/module-compiler.types.ts";
import { bootstrapAponiaApplication } from "./application-bootstrap.ts";
import { AponiaElysiaApplication } from "./aponia-elysia-application.ts";
import type {
  AponiaApplicationOptions,
  ConfiguredAponiaApplicationOptions,
} from "./application.types.ts";
import type { AponiaNativeApplication } from "./native-application.types.ts";

export class AponiaFactory {
  /**
   * Bootstrap an application behind Aponia's managed lifecycle facade.
   */
  static create<
    const TRootModule extends AponiaRootModule,
    const TNativeApplication extends AnyElysia,
  >(
    rootModule: TRootModule,
    options: ConfiguredAponiaApplicationOptions<TNativeApplication>,
  ): Promise<AponiaElysiaApplication<AponiaNativeApplication<TRootModule, TNativeApplication>>>;
  static create<const TRootModule extends AponiaRootModule>(
    rootModule: TRootModule,
    options?: AponiaApplicationOptions,
  ): Promise<AponiaElysiaApplication<AponiaNativeApplication<TRootModule>>>;
  static async create(
    rootModule: AponiaRootModule,
    options: AponiaApplicationOptions | ConfiguredAponiaApplicationOptions<AnyElysia> = {},
  ): Promise<AponiaElysiaApplication<AnyElysia>> {
    const { nativeApplication, logger } = await bootstrapAponiaApplication(rootModule, options);
    return new AponiaElysiaApplication(nativeApplication, logger);
  }

  /**
   * Bootstrap and return the composed Elysia instance itself.
   *
   * Statically declared native plugins and controller plugins retain their
   * exact route types for native Elysia tooling such as Eden Treaty.
   */
  static createNative<
    const TRootModule extends AponiaRootModule,
    const TNativeApplication extends AnyElysia,
  >(
    rootModule: TRootModule,
    options: ConfiguredAponiaApplicationOptions<TNativeApplication>,
  ): Promise<AponiaNativeApplication<TRootModule, TNativeApplication>>;
  static createNative<const TRootModule extends AponiaRootModule>(
    rootModule: TRootModule,
    options?: AponiaApplicationOptions,
  ): Promise<AponiaNativeApplication<TRootModule>>;
  static async createNative(
    rootModule: AponiaRootModule,
    options: AponiaApplicationOptions | ConfiguredAponiaApplicationOptions<AnyElysia> = {},
  ): Promise<AnyElysia> {
    const { nativeApplication } = await bootstrapAponiaApplication(rootModule, options);
    return nativeApplication;
  }
}
