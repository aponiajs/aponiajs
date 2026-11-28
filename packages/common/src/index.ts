export { defineConfiguration } from "./configuration/configuration.ts";
export type {
  ConfigurationOptions,
  ConfigurationToken,
} from "./interfaces/configuration.interface.ts";
export type { ControllerDefinition } from "./interfaces/controller.interface.ts";
export {
  All,
  Controller,
  Delete,
  Get,
  Global,
  Head,
  Inject,
  Injectable,
  Module,
  Options,
  Optional,
  Patch,
  Post,
  Put,
  getConstructorDependencies,
  getControllerMetadata,
  getInjectableMetadata,
  getModuleMetadata,
  getOptionalParameters,
  getRouteMetadata,
  isGlobalModule,
} from "./decorators/decorators.ts";
export { applyDecorators } from "./decorators/apply-decorators.ts";
export type {
  ControllerMetadata,
  DynamicModule,
  DynamicModuleOptions,
  InjectableOptions,
  ModuleClass,
  ModuleExport,
  ModuleImport,
  ModuleMetadata,
  ModuleProvider,
  RequestMethod,
  RouteDecoratorFactory,
  RouteMetadata,
  RouteMethodDecorator,
} from "./interfaces/decorators.interface.ts";
export {
  Catch,
  UseFilters,
  UseGuards,
  UseInterceptors,
  getCatchMetadata,
  getEnhancerMetadata,
} from "./enhancers/enhancer.decorator.ts";
export type { EnhancerMetadata } from "./interfaces/enhancer-decorators.interface.ts";
export {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  APP_PIPE,
  applicationEnhancerTokens,
  isApplicationEnhancerToken,
} from "./enhancers/enhancer-tokens.ts";
export type {
  ApplicationEnhancer,
  ApplicationEnhancerBinding,
} from "./enhancers/enhancer-tokens.ts";
export { SetMetadata, customMetadataPrefix, getCustomMetadata } from "./enhancers/metadata.ts";
export { Reflector } from "./enhancers/reflector.ts";
export type {
  ArgumentsHost,
  CanActivate,
  ExceptionFilter,
  ExecutionContext,
  HttpArgumentsHost,
  Interceptor,
  RpcArgumentsHost,
  WsArgumentsHost,
} from "./interfaces/enhancer.interface.ts";
export { AponiaError } from "./exceptions/aponia-error.ts";
export type { AponiaErrorCode } from "./exceptions/aponia-error.interface.ts";
export { HttpException } from "./exceptions/http.exception.ts";
export { IntrinsicException } from "./exceptions/intrinsic.exception.ts";
export { httpStatus } from "./exceptions/http-status.ts";
export type { HttpStatusCode, HttpStatusName } from "./exceptions/http-status.ts";
export {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  GoneException,
  HttpVersionNotSupportedException,
  ImATeapotException,
  InternalServerErrorException,
  MethodNotAllowedException,
  MisdirectedException,
  NotAcceptableException,
  NotFoundException,
  NotImplementedException,
  PayloadTooLargeException,
  PreconditionFailedException,
  RequestTimeoutException,
  ServiceUnavailableException,
  TooManyRequestsException,
  UnauthorizedException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
  type BuiltInExceptionOptions,
} from "./exceptions/built-in.exception.ts";
export { ClassSerializerInterceptor } from "./enhancers/class-serializer.interceptor.ts";
export { StandardSchemaValidationPipe, ValidationPipe } from "./pipes/validation.pipe.ts";
export type {
  StandardSchemaValidationPipeOptions,
  ValidationError,
  ValidationPipeOptions,
} from "./pipes/validation.pipe.ts";
export { Prompt, Resource, ResourceTemplate, Tool } from "./mcp/mcp.decorator.ts";
export { getMcpPrimitiveMetadata, mcpPrimitivesMetadataKey } from "./mcp/mcp-metadata.ts";
export type {
  McpPrimitiveKind,
  McpPrimitiveMetadata,
  McpPrimitiveOptions,
  McpPromptOptions,
  McpResourceOptions,
  McpResourceTemplateOptions,
  McpToolOptions,
} from "./interfaces/mcp.interface.ts";
export {
  registerAsyncContextExit,
  runOutsideAsyncContexts,
} from "./async-context/async-context.ts";
export type { AsyncContextExit } from "./async-context/async-context.ts";
export type {
  BeforeApplicationShutdown,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy,
  OnModuleInit,
} from "./interfaces/lifecycle.interface.ts";
export { ConsoleLogger, Logger } from "./services/console-logger.service.ts";
export { formatLogValue } from "./services/log-value.ts";
export { LOGGER } from "./services/logger-token.ts";
export {
  NOOP_LOGGER,
  notifySystemLogger,
  observeSystemLogger,
} from "./services/logger-observer.service.ts";
export type {
  ConsoleLoggerOptions,
  LoggerService,
  LogLevel,
} from "./interfaces/logger.interface.ts";
export type {
  AponiaMiddleware,
  AponiaModule,
  MiddlewareConfigProxy,
  MiddlewareConsumer,
  RouteTarget,
} from "./interfaces/middleware.interface.ts";
export { defineModule, dynamicModule, withModuleProviders } from "./modules/module.ts";
export {
  CONFIGURABLE_MODULE_ID,
  ConfigurableModuleBuilder,
  forFeature,
  type ConfigurableModuleAsyncOptions,
  type ConfigurableModuleBuilderOptions,
  type ConfigurableModuleClass,
  type ConfigurableModuleHost,
  type ConfigurableModuleOptionsFactory,
  type FeatureModuleOptions,
} from "./module-utils/configurable-module.builder.ts";
export { ModuleRef } from "./modules/module-ref.ts";
export type { ModuleRefGetOptions } from "./modules/module-ref.ts";
export { moduleOptionsProviders } from "./module-utils/module-async-options.ts";
export type {
  ModuleAsyncOptions,
  ModuleDefinition,
  ModuleDescriptor,
  ModuleImportDescriptor,
  ModuleOptions,
  ModuleOptionsFactory,
} from "./interfaces/module.interface.ts";
export {
  FORWARD_REF_SYMBOL,
  forwardRef,
  isForwardRef,
  resolveForwardRef,
} from "./modules/forward-ref.ts";
export type { ForwardReference } from "./interfaces/forward-ref.interface.ts";
export {
  DefaultValuePipe,
  ParseArrayPipe,
  ParseBoolPipe,
  ParseDatePipe,
  ParseEnumPipe,
  ParseFilePipe,
  ParseFloatPipe,
  ParseIntPipe,
  ParseUUIDPipe,
} from "./pipes/built-in.pipe.ts";
export type {
  ParseArrayPipeOptions,
  ParseDatePipeOptions,
  ParseEnumValues,
  ParseFilePipeOptions,
  ParsePipeOptions,
  UploadedFileLike,
} from "./pipes/built-in.pipe.ts";
export { UsePipes, getPipesMetadata } from "./pipes/pipe.decorator.ts";
export { pipeMetadataKey } from "./pipes/pipe.constants.ts";
export type {
  ArgumentMetadata,
  ArgumentType,
  PipeTransform,
  PipeType,
} from "./interfaces/pipe.interface.ts";
export {
  normalizeProvider,
  normalizeProviderScope,
  provideAlias,
  provideClass,
  provideFactory,
  provideValue,
} from "./providers/provider.ts";
export { Scope } from "./providers/provider.constants.ts";
export type {
  AliasProvider,
  ClassProvider,
  FactoryProvider,
  LegacyProviderScope,
  NestProvider,
  NormalizedProviderScope,
  Provider,
  ProviderScope,
  ValueProvider,
} from "./interfaces/provider.interface.ts";
export {
  Body,
  Context,
  Cookie,
  Headers,
  HostParam,
  HttpStatus,
  Ip,
  Param,
  Query,
  Req,
  ResponseSettings,
  State,
  UploadedFile,
  UploadedFiles,
  getRouteParameterMetadata,
  routeParameterKinds,
  routeParametersMetadataKey,
} from "./routing/route-parameters.ts";
export { createParamDecorator } from "./routing/custom-parameter.ts";
export type { CustomParamFactory } from "./interfaces/custom-parameter.interface.ts";
export { createDto } from "./routing/dto.ts";
export type { DtoConstructor, Infer } from "./routing/dto.ts";
export { Serialize, getResponseSerializer } from "./routing/response-serializer.ts";
export { SerializeOptions, getSerializeOptions } from "./routing/serialize-options.ts";
export type { SerializeOptions as SerializeOptionsInput } from "./routing/serialize-options.ts";
export { StreamableFile } from "./routing/streamable-file.ts";
export type { StreamableFileOptions } from "./routing/streamable-file.ts";
export { Header, HttpCode, getHttpCode, getResponseHeaders } from "./routing/response-metadata.ts";
export type { ResponseHeaderValue } from "./interfaces/response-metadata.interface.ts";
export { Render, getViewTemplate, getViewOptions } from "./routing/view.ts";
export { VIEW_ENGINE } from "./routing/view.ts";
export type { ViewEngine, ViewRenderOptions } from "./routing/view.ts";
export {
  Deprecated,
  applyDeprecationHeaders,
  getDeprecationMetadata,
} from "./routing/deprecation.ts";
export type { DeprecationMetadata, DeprecationOptions } from "./routing/deprecation.ts";
export type { ResponseSerializer } from "./routing/response-serializer.ts";
export {
  VERSION_NEUTRAL,
  Version,
  VersioningType,
  getVersionMetadata,
  versionPathSegment,
} from "./routing/versioning.ts";
export type { VersionValue } from "./routing/versioning.ts";
export { Sse, isSseRoute } from "./routing/sse.ts";
export type {
  RouteParameterKind,
  RouteParameterMetadata,
} from "./interfaces/route-parameters.interface.ts";
export {
  isRouteResponseSchemaMap,
  isStandardSchema,
  isValidatorSchema,
  routeSchemaSlots,
} from "./routing/route-schema.ts";
export {
  intersectSchema,
  omitSchema,
  partialSchema,
  pickSchema,
} from "./routing/schema-combinators.ts";
export type {
  InferValidatorOutput,
  ResponseSettingsState,
  RouteCookie,
  RouteContext,
  RouteResponseSchema,
  RouteResponseSchemaMap,
  RouteSchema,
  RouteSchemaSlot,
  RouteValidator,
  ValidatorSchema,
} from "./interfaces/route-schema.interface.ts";
export { Validation, getValidationMetadata, resolveRouteValidator } from "./routing/validation.ts";
export type {
  RouteValidatorInput,
  ValidationMetadata,
  ValidationModelClass,
} from "./interfaces/validation.interface.ts";
export {
  EventPattern,
  MESSAGE_HANDLER_ERROR_CODE,
  MessagePattern,
  Payload,
  UNKNOWN_MESSAGE_PATTERN_CODE,
  getMessagePatternMetadata,
  getMessagePayloadProperty,
  isMessagePattern,
  maximumMessagePatternLength,
  messageFailure,
  messagePatternMetadataKey,
  messagePayloadMetadataKey,
  normalizeMessagePattern,
} from "./microservices/message-pattern.ts";
export type {
  MessagePatternKind,
  MessagePatternMetadata,
} from "./microservices/message-pattern.ts";
export type {
  MicroserviceFailure,
  MicroserviceHandler,
  MicroserviceMessage,
  MicroserviceReply,
  MicroserviceTransport,
} from "./interfaces/microservice.interface.ts";
export {
  createToken,
  getTokenName,
  isOptionalInjection,
  optionalDependency,
} from "./tokens/token.ts";
export type {
  ClassToken,
  Constructor,
  InjectionDependency,
  InjectionToken,
  OptionalInjection,
  Token,
  TokenMap,
  TokenValue,
} from "./interfaces/token.interface.ts";
export {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  getWebSocketGatewayMetadata,
  getWebSocketMessageMetadata,
  getWebSocketParameterMetadata,
  getWebSocketServerProperties,
} from "./websockets/websocket.gateway.ts";
export type {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGatewayMetadata,
  WebSocketGatewayOptions,
  WebSocketMessageMetadata,
  WebSocketMessageSchema,
  WebSocketParameterKind,
  WebSocketParameterMetadata,
  WsResponse,
} from "./interfaces/websocket-gateway.interface.ts";
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
export { HttpError, httpError, httpErrors } from "./exceptions/http-error.ts";
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
  type HttpStatusReasonCode,
  type HttpStatusReasonName,
} from "./exceptions/http-status-map.ts";
export type {
  AponiaApplicationContract,
  GatewayServerOptions,
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
export { RouteContextMask } from "./kernel/route-context-mask.ts";
export type {
  HostRequestInfo,
  HttpKernelOptions,
  MountedRoute,
  PlatformRouteContext,
  ResolvedFilter,
  RouteMatch,
} from "./interfaces/kernel.interface.ts";
export {
  defaultMaxBodyBytes,
  readBody,
  readCookies,
  readHeaders,
  readQuery,
  slicePathname,
} from "./kernel/request-decoding.ts";
export { buildResponse, hasResponseHeaderEntries } from "./kernel/response-building.ts";
export { clearCookie, writeCookie } from "./kernel/cookies.ts";
export type { CookieOptions } from "./kernel/cookies.ts";
export { compileSlotValidator, validateSlot } from "./kernel/validation.ts";
export type { CompiledSlotValidator, ValidationIssue } from "./kernel/validation.ts";
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
export type {
  RequestContext,
  RequestContextModuleOptions,
  RequestContextRegistration,
} from "./interfaces/request-context.interface.ts";

export { matchesFilter } from "./kernel/filter-matching.ts";
export { createRequestPipeline } from "./application/request-pipeline.ts";
export type { RequestPipelineOptions } from "./application/request-pipeline.ts";
export { compareRouteSpecificity } from "./routing/route-specificity.ts";
export { stripDangerousKeys } from "./routing/sanitize-input.ts";
export { mergeGatewayOptions } from "./websockets/gateway-options.ts";
