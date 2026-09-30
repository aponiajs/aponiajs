import type { AnyElysia } from "elysia";
import type { AponiaRootModule } from "../modules/module-compiler.types.ts";
import { bootstrapAponiaApplication } from "./application-bootstrap.ts";
import { AponiaApplication } from "./aponia-elysia-application.ts";
import type {
  AponiaApplicationOptions,
  ConfiguredAponiaApplicationOptions,
} from "./application.types.ts";
import type { ElysiaApplication } from "./native-application.types.ts";

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
  ): Promise<AponiaApplication<ElysiaApplication<TRootModule, TNativeApplication>>>;
  static create<const TRootModule extends AponiaRootModule>(
    rootModule: TRootModule,
    options?: AponiaApplicationOptions,
  ): Promise<AponiaApplication<ElysiaApplication<TRootModule>>>;
  static async create(
    rootModule: AponiaRootModule,
    options: AponiaApplicationOptions | ConfiguredAponiaApplicationOptions<AnyElysia> = {},
  ): Promise<AponiaApplication<AnyElysia>> {
    const { nativeApplication, logger } = await bootstrapAponiaApplication(rootModule, options);
    return new AponiaApplication(nativeApplication, logger);
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
  ): Promise<ElysiaApplication<TRootModule, TNativeApplication>>;
  static createNative<const TRootModule extends AponiaRootModule>(
    rootModule: TRootModule,
    options?: AponiaApplicationOptions,
  ): Promise<ElysiaApplication<TRootModule>>;
  static async createNative(
    rootModule: AponiaRootModule,
    options: AponiaApplicationOptions | ConfiguredAponiaApplicationOptions<AnyElysia> = {},
  ): Promise<AnyElysia> {
    const { nativeApplication } = await bootstrapAponiaApplication(rootModule, options);
    return nativeApplication;
  }
}
