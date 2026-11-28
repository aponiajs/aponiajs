import {
  AponiaError,
  getWebSocketGatewayMetadata,
  getWebSocketMessageMetadata,
  getWebSocketParameterMetadata,
  getWebSocketServerProperties,
  isStandardSchema,
  resolveRouteValidator,
  type CanActivate,
  type ClassToken,
  type ModuleDefinition,
  type RouteValidatorInput,
  type WebSocketMessageSchema,
  type WebSocketParameterMetadata,
} from "@aponiajs/common";
import { TypeBoxValidator } from "elysia";
import type { TSchema } from "typebox/type";
import {
  invalidGatewayDeclaration,
  invalidGatewayDefinition,
  normalizeGatewayPath,
} from "./gateway-binding.ts";
import { isObject, sendException } from "./gateway-dispatch.ts";
import type { WebSocketGatewayPlan } from "../interfaces/gateway-plan.interface.ts";
import type {
  CompiledWebSocketGateway,
  CompiledWebSocketHandler,
  WebSocketClient,
  WebSocketMessageInvoker,
} from "../interfaces/websocket-gateway.interface.ts";

type MessageHandler = (...arguments_: unknown[]) => unknown;
type MessageInvokerFactory = (
  handler: MessageHandler,
  instance: unknown,
) => WebSocketMessageInvoker;

/**
 * The path a gateway that declares none is mounted at. Mirrors the default in
 * `@aponiajs/common`'s `normalizeGatewayPath`.
 */
const defaultGatewayPath = "/ws";

/**
 * The property a declared gateway provider carries its plan on, which is the
 * field `defineWebSocketGateway` writes.
 */
const declaredGatewayPlanKey = "gateway";

/** One message handler, before it is compiled into an invoker factory. */
/** @internal */
export interface GatewayHandlerPlan {
  readonly event: string;
  readonly propertyKey: string | symbol;
  readonly schema?: WebSocketMessageSchema | undefined;
  readonly parameters: readonly WebSocketParameterMetadata[];
}

/** Everything a gateway declares, however it was authored. */
/** @internal */
export interface GatewayPlan {
  readonly path: string;
  readonly maxPayloadLength?: number | undefined;
  readonly guards?: readonly ClassToken<CanActivate>[] | undefined;
  readonly origins?: readonly string[] | undefined;
  readonly idleTimeoutMs?: number | undefined;
  readonly sendPings?: boolean | undefined;
  readonly handlers: readonly GatewayHandlerPlan[];
  readonly serverProperties: readonly (string | symbol)[];
}

/**
 * The plan a class provider declares, or `undefined` when the provider is not a
 * gateway at all.
 *
 * A provider carrying a `gateway` plan is a declared one, and nothing is read
 * from its class. Every other class provider takes the decorator path, which is
 * the one that existed before declared gateways did.
 *
 * @internal
 */
export function readGatewayPlan(
  module: ModuleDefinition,
  provider: Extract<ModuleDefinition["providers"][number], { readonly kind: "class" }>,
  gatewayClass: ClassToken<unknown>,
): GatewayPlan | undefined {
  const declared = Reflect.get(provider, declaredGatewayPlanKey) as
    | WebSocketGatewayPlan
    | undefined;
  if (declared !== undefined) {
    return readDeclaredGatewayPlan(module, gatewayClass, declared);
  }

  const metadata = getWebSocketGatewayMetadata(gatewayClass);
  if (!metadata) {
    return undefined;
  }

  return {
    path: metadata.path,
    maxPayloadLength: metadata.maxPayloadLength,
    guards: metadata.guards,
    origins: metadata.origins,
    idleTimeoutMs: metadata.idleTimeoutMs,
    sendPings: metadata.sendPings,
    handlers: getWebSocketMessageMetadata(gatewayClass).map((message) =>
      Object.freeze({
        event: message.event,
        propertyKey: message.propertyKey,
        schema: message.schema,
        parameters: getWebSocketParameterMetadata(gatewayClass, message.propertyKey),
      }),
    ),
    serverProperties: getWebSocketServerProperties(gatewayClass),
  };
}

/**
 * Reads the plan a declared gateway provider carries.
 *
 * The shape is validated rather than trusted, because a hand-written provider
 * literal is the escape hatch this path exists to support: a plan that is not an
 * object, or whose handlers or server properties are not arrays, would otherwise
 * mount a gateway that silently ignores what it declares.
 *
 * @internal
 */
export function readDeclaredGatewayPlan(
  module: ModuleDefinition,
  gatewayClass: ClassToken<unknown>,
  plan: unknown,
): GatewayPlan {
  const gatewayName = gatewayClass.name;
  if (!isObject(plan)) {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      "declares a gateway plan that is not an object.",
    );
  }

  const handlers = Reflect.get(plan, "handlers") ?? [];
  if (!Array.isArray(handlers)) {
    throw invalidGatewayDeclaration(module, gatewayName, 'must declare "handlers" as an array.');
  }

  const serverProperties = Reflect.get(plan, "serverProperties") ?? [];
  if (!Array.isArray(serverProperties)) {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      'must declare "serverProperties" as an array.',
    );
  }

  const path = Reflect.get(plan, "path");
  if (path !== undefined && typeof path !== "string") {
    throw invalidGatewayDeclaration(module, gatewayName, "must declare its path as a string.");
  }

  const maxPayloadLength = Reflect.get(plan, "maxPayloadLength");
  if (
    maxPayloadLength !== undefined &&
    (typeof maxPayloadLength !== "number" ||
      !Number.isSafeInteger(maxPayloadLength) ||
      maxPayloadLength <= 0)
  ) {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      'must declare "maxPayloadLength" as a positive integer.',
    );
  }

  const idleTimeoutMs = Reflect.get(plan, "idleTimeoutMs");
  if (
    idleTimeoutMs !== undefined &&
    (typeof idleTimeoutMs !== "number" ||
      !Number.isSafeInteger(idleTimeoutMs) ||
      idleTimeoutMs <= 0)
  ) {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      'must declare "idleTimeoutMs" as a positive integer.',
    );
  }

  const sendPings = Reflect.get(plan, "sendPings");
  if (sendPings !== undefined && typeof sendPings !== "boolean") {
    throw invalidGatewayDeclaration(module, gatewayName, 'must declare "sendPings" as a boolean.');
  }

  const guards = Reflect.get(plan, "guards");
  if (guards !== undefined) {
    if (!Array.isArray(guards)) {
      throw invalidGatewayDeclaration(module, gatewayName, 'must declare "guards" as an array.');
    }
    for (const guard of guards) {
      if (typeof guard !== "function") {
        throw invalidGatewayDeclaration(
          module,
          gatewayName,
          'must declare "guards" containing only guard classes.',
        );
      }
    }
  }

  const origins = Reflect.get(plan, "origins");
  if (origins !== undefined) {
    if (!Array.isArray(origins) || origins.length === 0) {
      throw invalidGatewayDeclaration(
        module,
        gatewayName,
        'must declare "origins" as a non-empty array.',
      );
    }
    for (const origin of origins) {
      if (typeof origin !== "string" || origin.trim() === "") {
        throw invalidGatewayDeclaration(
          module,
          gatewayName,
          'must declare "origins" containing only non-empty strings.',
        );
      }
    }
  }

  return {
    path: path ?? defaultGatewayPath,
    maxPayloadLength: typeof maxPayloadLength === "number" ? maxPayloadLength : undefined,
    guards: guards ? Object.freeze([...(guards as readonly ClassToken<CanActivate>[])]) : undefined,
    origins: origins ? Object.freeze([...(origins as readonly string[])]) : undefined,
    idleTimeoutMs: typeof idleTimeoutMs === "number" ? idleTimeoutMs : undefined,
    sendPings: typeof sendPings === "boolean" ? sendPings : undefined,
    handlers: Object.freeze(
      handlers.map((handler) => readDeclaredGatewayHandler(module, gatewayName, handler)),
    ),
    serverProperties: Object.freeze([...(serverProperties as readonly (string | symbol)[])]),
  };
}

/**
 * Reads one declared handler.
 *
 * The event is the handler's whole identity — it is the key a message is routed
 * by — so a plan that declares an empty one, or none at all, is refused rather
 * than mounted as a handler no client can reach.
 *
 * @internal
 */
export function readDeclaredGatewayHandler(
  module: ModuleDefinition,
  gatewayName: string,
  handler: unknown,
): GatewayHandlerPlan {
  if (!isObject(handler)) {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      "declares a handler that is not an object.",
    );
  }

  const event = Reflect.get(handler, "event");
  const propertyKey = Reflect.get(handler, "propertyKey");
  const parameters = Reflect.get(handler, "parameters") ?? [];
  if (typeof event !== "string" || event.trim().length === 0) {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      "declares a handler whose event is not a non-empty string.",
    );
  }
  if (typeof propertyKey !== "string" && typeof propertyKey !== "symbol") {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      "declares a handler without a property key.",
    );
  }
  if (!Array.isArray(parameters)) {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      "declares a handler whose parameters are not an array.",
    );
  }

  const schema = Reflect.get(handler, "schema");
  if (
    schema !== undefined &&
    (typeof schema !== "object" || schema === null || Array.isArray(schema))
  ) {
    throw invalidGatewayDeclaration(
      module,
      gatewayName,
      'must declare handler "schema" as an object.',
    );
  }

  return Object.freeze({
    event,
    propertyKey,
    schema: schema as WebSocketMessageSchema | undefined,
    parameters: parameters as readonly WebSocketParameterMetadata[],
  });
}

/** @internal */
export function compileGateway(
  module: ModuleDefinition,
  provider: Extract<ModuleDefinition["providers"][number], { readonly kind: "class" }>,
  gatewayClass: ClassToken<unknown>,
  plan: GatewayPlan,
): CompiledWebSocketGateway {
  const gatewayName = gatewayClass.name;
  const path = plan.path;
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new AponiaError(
      "INVALID_WEBSOCKET_GATEWAY",
      `WebSocket gateway "${gatewayName}" has an invalid path.`,
      { module: module.id, gateway: gatewayName },
    );
  }
  const normalizedPath = normalizeGatewayPath(path);

  const handlers: CompiledWebSocketHandler[] = [];
  const events = new Map<string, string | symbol>();
  for (const declared of plan.handlers) {
    const existing = events.get(declared.event);
    if (existing !== undefined) {
      throw new AponiaError(
        "DUPLICATE_WEBSOCKET_HANDLER",
        `WebSocket gateway "${gatewayName}" has more than one handler for event "${declared.event}".`,
        {
          module: module.id,
          gateway: gatewayName,
          event: declared.event,
          handlers: Object.freeze([String(existing), String(declared.propertyKey)]),
        },
      );
    }

    const prototypeHandler = Reflect.get(gatewayClass.prototype, declared.propertyKey) as unknown;
    if (typeof prototypeHandler !== "function") {
      throw invalidGatewayDefinition(
        module,
        gatewayName,
        declared.propertyKey,
        "The message handler is not callable.",
      );
    }

    const parameters = declared.parameters;
    assertDistinctParameterIndexes(module, gatewayName, declared.propertyKey, parameters);
    const invokerFactory = compileMessageInvoker(parameters);
    const validateData =
      declared.schema?.data !== undefined
        ? compileDataValidator(resolveRouteValidator(declared.schema.data as RouteValidatorInput))
        : undefined;

    handlers.push(
      Object.freeze({
        event: declared.event,
        propertyKey: declared.propertyKey,
        schema: declared.schema,
        createInvoker: (instance: unknown) => {
          const handler = isObject(instance)
            ? Reflect.get(instance, declared.propertyKey)
            : undefined;
          if (typeof handler !== "function") {
            throw invalidGatewayDefinition(
              module,
              gatewayName,
              declared.propertyKey,
              "The resolved message handler is not callable.",
            );
          }
          const baseInvoker = invokerFactory(handler as MessageHandler, instance);
          if (validateData === undefined) {
            return baseInvoker;
          }
          return async (socket: WebSocketClient, data: unknown) => {
            const validationPromise = validateData(data);
            const validation =
              typeof (validationPromise as Promise<DataValidationResult>)?.then === "function"
                ? await validationPromise
                : (validationPromise as DataValidationResult);
            if (!validation.success) {
              sendException(socket, "INVALID_WEBSOCKET_MESSAGE", "Invalid WebSocket message data.");
              return undefined;
            }
            return baseInvoker(socket, validation.value);
          };
        },
      }),
    );
    events.set(declared.event, declared.propertyKey);
  }

  return Object.freeze({
    module,
    provider,
    token: provider.provide,
    gatewayName,
    path: normalizedPath,
    maxPayloadLength: plan.maxPayloadLength,
    guards: plan.guards,
    origins: plan.origins,
    idleTimeoutMs: plan.idleTimeoutMs,
    sendPings: plan.sendPings,
    handlers: Object.freeze(handlers),
    serverProperties: Object.freeze([...plan.serverProperties]),
  });
}

type DataValidationResult =
  | { readonly success: true; readonly value: unknown }
  | { readonly success: false };

type DataValidator = (data: unknown) => DataValidationResult | Promise<DataValidationResult>;

/** Narrows a sync/async Standard Schema result without importing its namespace. */
/** @internal */
export function isPromiseResult<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T> | undefined)?.then === "function";
}

/** @internal */
export function compileDataValidator(validator: unknown): DataValidator {
  if (isStandardSchema(validator)) {
    const standard = validator["~standard"];
    return (data: unknown) => {
      const result = standard.validate(data);
      if (isPromiseResult(result)) {
        return result.then((asyncRes) => {
          if (asyncRes.issues && asyncRes.issues.length > 0) {
            return { success: false };
          }
          return { success: true, value: "value" in asyncRes ? asyncRes.value : data };
        });
      }
      if (result.issues && result.issues.length > 0) {
        return { success: false };
      }
      return { success: true, value: "value" in result ? result.value : data };
    };
  }

  if (typeof validator === "object" && validator !== null) {
    const typebox = new TypeBoxValidator(validator as TSchema);
    return (data: unknown) => {
      if (typebox.Check(data)) {
        return { success: true, value: data };
      }
      return { success: false };
    };
  }

  if (typeof validator === "function") {
    return (data: unknown) => {
      try {
        const result = (validator as (val: unknown) => unknown)(data);
        if (typeof (result as Promise<unknown>)?.then === "function") {
          return (result as Promise<unknown>).then(
            (asyncRes) => {
              if (asyncRes === false) {
                return { success: false };
              }
              return { success: true, value: asyncRes === true ? data : asyncRes };
            },
            () => ({ success: false }),
          );
        }
        if (result === false) {
          return { success: false };
        }
        return { success: true, value: result === true ? data : result };
      } catch {
        return { success: false };
      }
    };
  }

  return (data: unknown) => ({ success: true, value: data });
}

/** @internal */
export function assertDistinctParameterIndexes(
  module: ModuleDefinition,
  gatewayName: string,
  propertyKey: string | symbol,
  parameters: readonly WebSocketParameterMetadata[],
): void {
  const indexes = new Set<number>();
  for (const parameter of parameters) {
    if (indexes.has(parameter.index)) {
      throw invalidGatewayDefinition(
        module,
        gatewayName,
        propertyKey,
        `Message handler parameter ${parameter.index} has more than one WebSocket decorator.`,
      );
    }
    indexes.add(parameter.index);
  }
}

/** @internal */
export function compileMessageInvoker(
  parameters: readonly WebSocketParameterMetadata[],
): MessageInvokerFactory {
  if (parameters.length === 0) {
    return createMessageInvokerFactory("");
  }

  const arguments_ = Array.from({ length: parameters.at(-1)!.index + 1 }, () => "undefined");
  for (const parameter of parameters) {
    arguments_[parameter.index] = parameterExpression(parameter);
  }
  return createMessageInvokerFactory(arguments_.join(","));
}

const messageInvokerFactories = new Map<string, MessageInvokerFactory>();

/** @internal */
export function createMessageInvokerFactory(argumentsSource: string): MessageInvokerFactory {
  const cached = messageInvokerFactories.get(argumentsSource);
  if (cached) {
    return cached;
  }

  const invocation = `handler.call(instance${argumentsSource ? `,${argumentsSource}` : ""})`;
  // Property names are JSON-encoded before interpolation. The handler and
  // instance remain closed values, matching Elysia's own compiled hot path.
  // oxlint-disable-next-line typescript/no-implied-eval
  const factory = Function(
    "handler",
    "instance",
    `"use strict";return(socket,data)=>${invocation}`,
  ) as MessageInvokerFactory;
  messageInvokerFactories.set(argumentsSource, factory);
  return factory;
}

/** @internal */
export function parameterExpression(parameter: WebSocketParameterMetadata): string {
  if (parameter.kind === "connected-socket") {
    return "socket";
  }
  if (parameter.property === undefined) {
    return "data";
  }

  const property = JSON.stringify(parameter.property);
  return `(typeof data==="object"&&data!==null?data[${property}]:undefined)`;
}
