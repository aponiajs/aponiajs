export { selectInvokerArtifact } from "./artifacts/invoker-artifact.ts";
export type {
  AponiaInvokerArtifact,
  AponiaInvokerSelection,
} from "./interfaces/invoker-artifact.interface.ts";
export { selectRootModuleDescriptor } from "./artifacts/module-descriptor-artifact.ts";
export type {
  AponiaModuleDescriptorArtifact,
  AponiaRootModuleSelection,
} from "./interfaces/module-descriptor-artifact.interface.ts";
export {
  AponiaFactory,
  AponiaHttpApplication,
  createPlatformFactory,
} from "./application/http-bootstrap.ts";
export {
  BOOT_DIAGNOSTICS,
  createBootDiagnosticsRef,
  readBootDiagnostics,
} from "./application/boot-diagnostics.ts";
export type {
  AponiaBootDiagnostics,
  AponiaCallbackRouteDiagnostics as AponiaNeutralCallbackRouteDiagnostics,
  AponiaRouteDiagnostics,
  BootDiagnosticsRef,
} from "./application/boot-diagnostics.ts";
export {
  APPLICATION_CONTAINER,
  attachApplicationContainer,
  createApplicationContainerRef,
  getApplicationContainer,
} from "./application/application-container.ts";
export type { ApplicationContainerRef } from "./application/application-container.ts";
export type {
  AponiaHttpApplicationBoot,
  BootedHttpApplication,
  ListenerRef,
} from "./application/http-bootstrap.ts";
export type {
  AponiaApplicationSurfaceConfig,
  AponiaHttpApplicationOptions,
  AponiaListenOptions,
} from "./interfaces/application.interface.ts";
export {
  createApplicationSurfaceConfig,
  mergeApplicationSurfaceOptions,
} from "./application/application-surface.ts";
export {
  installShutdownSignalHandlers,
  type ShutdownSignal,
  type ShutdownSignalTarget,
} from "./application/shutdown-signals.ts";
export { RequestContextModule } from "./request-context/request-context.module.ts";
export {
  REQUEST_CONTEXT_REGISTRATION,
  RequestContextService,
} from "./request-context/request-context.service.ts";
export { isValidRequestId, resolveRequestId } from "./request-context/request-context-header.ts";
export type {
  RequestContext,
  RequestContextModuleOptions,
  RequestContextRegistration,
} from "./interfaces/request-context.interface.ts";
export {
  collectApplicationEnhancerEntries,
  resolveApplicationEnhancer,
  resolveApplicationFilters,
  resolveApplicationGuards,
  resolveApplicationInterceptors,
  resolveApplicationPipeOccurrences,
} from "./application/application-enhancers.ts";
export type {
  ApplicationEnhancerOccurrence,
  ResolvedApplicationFilter,
} from "./application/application-enhancers.ts";
export {
  attachApplicationShutdown,
  collectLifecycleCalls,
  lifecycleCallable,
  readApplicationShutdown,
} from "./application/lifecycle-hooks.ts";
export type {
  ApplicationShutdown,
  LifecycleCall,
  LifecycleCollectionOptions,
  LifecycleHookContract,
} from "./application/lifecycle-hooks.ts";
export { HttpError, httpError, httpErrors } from "./exceptions/http-error.ts";
export {
  CONTEXT,
  ContextIdFactory,
  INQUIRER,
  REQUEST,
  REQUEST_CONTEXT_ID,
  attachRequestContextId,
} from "@aponiajs/core";
export type {
  ContextId,
  ContextIdResolver,
  ContextIdResolverFn,
  ContextIdStrategy,
  HostComponentInfo,
} from "@aponiajs/core";
export type { HttpErrorFactories } from "./exceptions/http-error.ts";
export type {
  HttpErrorFactory,
  HttpErrorOptions,
  HttpErrorStatus,
  HttpErrorStatusCode,
  HttpErrorStatusName,
  ProblemDetails,
  ResolveHttpErrorStatus,
} from "./interfaces/http-error.interface.ts";
export {
  httpStatusCodes,
  statusCodeOf,
  statusNameOf,
  type HttpStatusCode,
  type HttpStatusName,
} from "./exceptions/http-status.ts";
export type {
  AponiaAdapter,
  AponiaApplicationContract,
  ApplicationAdapter,
  GatewayServerOptions,
  HostDispatcher,
  KernelAdapter,
  PlatformHost,
  PlatformMountOptions,
  PlatformRouteHandler,
  RequestPipeline,
} from "./interfaces/platform-host.interface.ts";
export { createGatewayDispatcher, injectGatewayServer } from "./websockets/gateway-dispatch.ts";
export { compileGatewayPlan } from "./websockets/gateway-plan.ts";
export type {
  GatewayHandlerPlan,
  GatewayHooks,
  GatewayHost,
  GatewayPlan,
  GatewayServer,
  GatewaySocket,
} from "./interfaces/gateway.interface.ts";
export { createHttpKernel, createRouteHandler } from "./kernel/http-kernel.ts";
export type { RouteExecutionRuntime } from "./kernel/http-kernel.ts";
export type {
  HostRequestInfo,
  HttpKernel,
  HttpKernelOptions,
  MountedRoute,
  PlatformRouteContext,
  ResolvedFilter,
  RouteMatch,
} from "./interfaces/kernel.interface.ts";
export { buildArguments, readParameterValue } from "./kernel/parameter-binding.ts";
export {
  defaultMaxBodyBytes,
  readBody,
  readCookies,
  readHeaders,
  readQuery,
} from "./kernel/request-decoding.ts";
export { buildResponse } from "./kernel/response-building.ts";
export { clearCookie, writeCookie } from "./kernel/cookies.ts";
export type { CookieOptions } from "./kernel/cookies.ts";
export { createRouteMatcher } from "./kernel/route-matcher.ts";
export type { RouteMatcher } from "./kernel/route-matcher.ts";
export { validateSlot } from "./kernel/validation.ts";
export type { ValidationIssue } from "./kernel/validation.ts";
export { compileGuardsHook, compileUnrolledGuards } from "./enhancers/enhancer-pipeline.ts";
export { StaticRouteExecutionContext } from "./enhancers/static-execution-context.ts";
export { createMiddlewareConsumer } from "./middleware/middleware-consumer.ts";
export {
  collectModuleMiddleware,
  isMiddlewareRouteExcluded,
  matchesMiddlewarePath,
  matchesMiddlewareTarget,
  normalizeMiddlewarePath,
  resolveMiddlewareInstance,
  runMiddlewareChain,
} from "./middleware/route-matching.ts";
export type { ResolvedMiddlewareConfig } from "./interfaces/middleware-consumer.interface.ts";
export { HttpAdapterHost, provideHttpAdapterHost } from "./host/http-adapter-host.ts";
export {
  ALL_PLATFORMS,
  applyPlatformModules,
  PLATFORM_ADAPTER_HOST,
  providePlatformModule,
  resolvePlatformModules,
} from "./platform/platform-module.ts";
export type {
  PlatformAdapterEntry,
  PlatformAdapterHost,
  PlatformModuleAdapter,
  PlatformModuleSupport,
  ResolvedPlatformModule,
} from "./platform/platform-module.types.ts";
export type { AsyncPluginOptions } from "./platform/plugin-builder.types.ts";
export { provideConfiguration, provideConfigurationAsync } from "./configuration/provider.ts";
export type { AsyncConfigurationOptions } from "./configuration/provider.ts";
export { AuthGuard } from "./security/auth.guard.ts";
export { RolesGuard } from "./security/roles.guard.ts";
export type { AuthGuardOptions, AuthenticatedUser } from "./interfaces/security.interface.ts";
export {
  answerHealthProbe,
  ApplicationReadiness,
  compileHealthProbes,
} from "./health/health-probes.ts";
export type { HealthProbeMount } from "./health/health-probes.ts";
export type {
  AponiaHealthOptions,
  AponiaHealthResponse,
  AponiaHealthStatus,
} from "./interfaces/health.interface.ts";
export type {
  AponiaRootModule,
  ResolvedModuleImports,
} from "./interfaces/module-compiler.interface.ts";
export {
  compileRootModule,
  compileRootModuleAsync,
  HttpControllerKind,
  isModuleDefinition,
} from "./modules/module-compiler.ts";
export { resolveModuleImports } from "./modules/module-import.resolver.ts";
export type { RootCompilationOptions } from "./modules/module-compiler.ts";
export {
  executePipes,
  resolveApplicationPipe,
  resolveApplicationPipes,
  resolvePipe,
} from "./pipes/pipe.resolver.ts";
export type { ParameterPipesMap, ResolvedPipe } from "./interfaces/pipe-resolver.interface.ts";
export type { CompiledRoute } from "./interfaces/compiled-route.interface.ts";
export { compileRoutes } from "./routing/route-compilation.ts";
export { joinPaths } from "./routing/route-path.ts";
export type { RoutePlan } from "./interfaces/route-plan.interface.ts";
export { normalizeRoutePrefix, stripRoutePrefix } from "./routing/route-prefix.ts";
export { contentDisposition } from "./routing/content-disposition.ts";
export type { DownloadFileOptions } from "./interfaces/content-disposition.interface.ts";
export {
  answerStaticAsset,
  normalizeStaticAssets,
  resolveStaticAssetPath,
} from "./routing/static-assets.ts";
export type { StaticFileOpener, StaticFileSource } from "./routing/static-assets.ts";
export type { StaticAssetsOptions } from "./interfaces/static-assets.interface.ts";
export {
  applyCors,
  applyHttpPolicies,
  applyHttpPolicyResponses,
  corsPreflight,
  HTTP_POLICIES,
  provideHttpPolicies,
  provideHttpPoliciesAsync,
  provideHttpPolicy,
  provideHttpPolicyAsync,
  resolveApplicationHttpPolicies,
  resolveCorsOptions,
  resolveHttpPolicies,
  runHttpPolicyRequests,
} from "./policy/http.policy.ts";
export type {
  CompressionOptions,
  CorsOptions,
  EtagOptions,
  HttpPolicy,
  HttpPolicyOptions,
  ResolvedCors,
  ResolvedHttpPolicies,
  SecurityHeadersOptions,
} from "./interfaces/http-policy.interface.ts";
export {
  assertPlatformCapabilities,
  PLATFORM_CAPABILITIES,
  PLATFORM_CAPABILITY_REQUIREMENT,
  platformCapabilities,
  providePlatformCapabilities,
  readPlatformCapabilities,
  requirePlatformCapabilities,
} from "./capabilities/platform-capabilities.ts";
export type {
  PlatformCapabilities,
  PlatformCapability,
  PlatformCapabilityRequirement,
} from "./interfaces/platform-capabilities.interface.ts";
export {
  notifyRequestError,
  notifyRequestResponse,
  provideRequestLifecycleHook,
  provideRequestLifecycleHooks,
  provideRequestLifecycleHooksAsync,
  REQUEST_LIFECYCLE_HOOKS,
  resolveRequestLifecycleHooks,
  runRequestHooks,
} from "./kernel/request-hooks.ts";
export type { RequestLifecycleHook } from "./interfaces/request-hooks.interface.ts";
export { matchedRouteOf, rememberMatchedRoute } from "./kernel/matched-route.ts";
export { createVersionNegotiator } from "./routing/version-negotiation.ts";
export type {
  AponiaVersioningOptions,
  VersionNegotiationRoute,
  VersionNegotiator,
} from "./interfaces/version-negotiation.interface.ts";
export type {
  ControllerHandlerFactory,
  RouteHandler,
} from "./interfaces/route-handler.interface.ts";
