/**
 * The five moments an application can hook, in the order a boot reaches them.
 *
 * A hook is a method on a provider instance, and the platform reads it from
 * there rather than from metadata or a descriptor field — the same way an
 * interceptor's halves are read — so a class registered by a hand-written
 * descriptor carries them with no declaration of its own. These interfaces
 * exist so a class can say `implements OnModuleInit` and be told when a
 * signature drifts, exactly as they do in Nest.
 *
 * Nothing in this package calls them: `@aponiajs/common` states the contract,
 * and the platform owns the timing.
 *
 * Every hook below runs on singleton instances only. A provider that declares
 * a `"request"` or `"transient"` scope has no hook timing yet: calling
 * `onModuleInit` once per request would turn a boot hook into a request hook,
 * and a transient instance that is never cached has no moment a destroy hook
 * could attach to. Scoped instances therefore receive no calls until the
 * scope lands, and the platform collects calls only from the singleton
 * instances it created at boot.
 */

/** Runs once its module's providers and controllers exist. */
export interface OnModuleInit {
  onModuleInit(): void | Promise<void>;
}

/** Runs once, after every module is initialized and every route and gateway is mounted. */
export interface OnApplicationBootstrap {
  onApplicationBootstrap(): void | Promise<void>;
}

/** Runs while the application is stopping, before the server stops. */
export interface BeforeApplicationShutdown {
  beforeApplicationShutdown(): void | Promise<void>;
}

/** Runs while the application is stopping, after the server has stopped. */
export interface OnModuleDestroy {
  onModuleDestroy(): void | Promise<void>;
}

/** Runs last, once the application has stopped. */
export interface OnApplicationShutdown {
  onApplicationShutdown(): void | Promise<void>;
}
