import "reflect-metadata";
import type { CanActivate } from "../enhancers/enhancer.types.ts";
import type { ClassToken } from "../tokens/token.types.ts";
import type {
  WebSocketGatewayMetadata,
  WebSocketGatewayOptions,
  WebSocketMessageMetadata,
  WebSocketMessageSchema,
  WebSocketParameterKind,
  WebSocketParameterMetadata,
} from "./websocket-gateway.types.ts";

const webSocketGatewayMetadataKey = Symbol.for("aponia.websocket-gateway.metadata");
const webSocketMessageMetadataKey = Symbol.for("aponia.websocket-message.metadata");
const webSocketParameterMetadataKey = Symbol.for("aponia.websocket-parameters.metadata");
const webSocketServerPropertiesMetadataKey = Symbol.for(
  "aponia.websocket-server-properties.metadata",
);

interface StoredWebSocketParameterMetadata extends WebSocketParameterMetadata {
  readonly propertyKey: string | symbol;
}

/**
 * Declares a WebSocket gateway: a class provider whose message handlers the
 * platform mounts as one native route.
 *
 * A gateway is a provider in `@Module({ providers })`, resolved as the
 * existing singleton instance — never a second construction.
 */
export function WebSocketGateway(): ClassDecorator;
/**
 * Declares a WebSocket gateway at a path.
 *
 * @param path - The mount path; defaults to `"/ws"`.
 * @returns A class decorator recording the frozen gateway metadata.
 *
 * @example
 * ```ts
 * @WebSocketGateway("/events")
 * class EventsGateway {}
 * ```
 */
export function WebSocketGateway(path: string): ClassDecorator;
/**
 * Declares a WebSocket gateway with options.
 *
 * @param options - The gateway options carrying the mount path.
 * @returns A class decorator recording the frozen gateway metadata.
 */
export function WebSocketGateway(options: WebSocketGatewayOptions): ClassDecorator;
export function WebSocketGateway(
  pathOrOptions: string | WebSocketGatewayOptions = {},
): ClassDecorator {
  const metadata = normalizeGatewayOptions(pathOrOptions);

  return (target) => {
    if (typeof target !== "function") {
      throw new TypeError("@WebSocketGateway can only decorate a class.");
    }

    Reflect.defineMetadata(webSocketGatewayMetadataKey, metadata, target);
  };
}

/**
 * Declares a named message handler on a gateway.
 *
 * Incoming socket messages are the `{ event, data }` envelope; a handler's
 * ordinary result is emitted under the subscribed event, `WsResponse` selects
 * a different one, and `undefined` sends nothing.
 *
 * @param event - The message event this method answers; must be non-empty.
 * @returns A method decorator recording the frozen message metadata.
 * @throws A `TypeError` when the event is empty or the target is not an
 * instance method.
 *
 * @example
 * ```ts
 * @SubscribeMessage("orders.create")
 * create(@MessageBody() input: CreateOrderDto) {}
 * ```
 */
export function SubscribeMessage(event: string, schema?: WebSocketMessageSchema): MethodDecorator {
  if (typeof event !== "string" || event.trim().length === 0) {
    throw new TypeError("@SubscribeMessage requires a non-empty event name.");
  }
  if (
    schema !== undefined &&
    (typeof schema !== "object" || schema === null || Array.isArray(schema))
  ) {
    throw new TypeError("@SubscribeMessage schema must be an object.");
  }

  return (target, propertyKey, descriptor) => {
    if (
      typeof target === "function" ||
      propertyKey === undefined ||
      typeof descriptor?.value !== "function"
    ) {
      throw new TypeError("@SubscribeMessage can only decorate an instance method.");
    }

    const messages =
      (Reflect.getOwnMetadata(webSocketMessageMetadataKey, target) as
        | readonly WebSocketMessageMetadata[]
        | undefined) ?? [];
    const frozenSchema = schema !== undefined ? Object.freeze({ ...schema }) : undefined;

    Reflect.defineMetadata(
      webSocketMessageMetadataKey,
      Object.freeze([
        ...messages,
        Object.freeze({
          event,
          propertyKey,
          ...(frozenSchema !== undefined ? { schema: frozenSchema } : {}),
        }),
      ]),
      target,
    );
  };
}

/**
 * Injects the incoming message data, or one of its properties.
 *
 * @param property - The data property to inject, or the whole data when omitted.
 * @returns A parameter decorator recording the binding.
 */
export function MessageBody(property?: string): ParameterDecorator {
  if (property !== undefined && typeof property !== "string") {
    throw new TypeError("@MessageBody property must be a string.");
  }

  return createParameterDecorator("message-body", property);
}

/**
 * Injects the native client associated with the incoming message.
 *
 * @returns A parameter decorator recording the binding.
 */
export function ConnectedSocket(): ParameterDecorator {
  return createParameterDecorator("connected-socket");
}

/**
 * Injects the platform WebSocket server into a gateway property.
 *
 * The server is the root application, assigned before `afterInit` runs.
 *
 * @returns A property decorator recording the server property.
 * @throws A `TypeError` when applied to anything but an instance property.
 */
export function WebSocketServer(): PropertyDecorator {
  return (target, propertyKey) => {
    if (typeof target === "function" || isMethodOrAccessor(target, propertyKey)) {
      throw new TypeError("@WebSocketServer can only decorate an instance property.");
    }

    const properties =
      (Reflect.getOwnMetadata(webSocketServerPropertiesMetadataKey, target) as
        | readonly (string | symbol)[]
        | undefined) ?? [];
    if (properties.includes(propertyKey)) {
      return;
    }

    Reflect.defineMetadata(
      webSocketServerPropertiesMetadataKey,
      Object.freeze([...properties, propertyKey]),
      target,
    );
  };
}

/**
 * Reads the gateway metadata `@WebSocketGateway()` recorded, own-class only.
 *
 * @param target - The gateway class to read.
 * @returns The frozen gateway metadata, or `undefined` when the class declares none.
 */
export function getWebSocketGatewayMetadata(
  target: ClassToken<unknown>,
): Readonly<WebSocketGatewayMetadata> | undefined {
  return Reflect.getOwnMetadata(webSocketGatewayMetadataKey, target) as
    | Readonly<WebSocketGatewayMetadata>
    | undefined;
}

/**
 * Reads the message metadata `@SubscribeMessage()` recorded, in declaration order.
 *
 * @param target - The gateway class to read.
 * @returns The frozen message metadata list, empty when the class declares none.
 */
export function getWebSocketMessageMetadata(
  target: ClassToken<unknown>,
): readonly WebSocketMessageMetadata[] {
  const messages =
    (Reflect.getOwnMetadata(webSocketMessageMetadataKey, target.prototype) as
      | readonly WebSocketMessageMetadata[]
      | undefined) ?? [];
  return Object.freeze([...messages]);
}

/**
 * Reads the parameter bindings the message parameter decorators recorded for
 * one handler, in parameter order.
 *
 * @param target - The gateway class to read.
 * @param propertyKey - The handler method to read.
 * @returns The frozen binding list, empty when the handler declares none.
 */
export function getWebSocketParameterMetadata(
  target: ClassToken<unknown>,
  propertyKey: string | symbol,
): readonly WebSocketParameterMetadata[] {
  const parameters =
    (Reflect.getOwnMetadata(webSocketParameterMetadataKey, target.prototype) as
      | readonly StoredWebSocketParameterMetadata[]
      | undefined) ?? [];

  return Object.freeze(
    parameters
      .filter((parameter) => parameter.propertyKey === propertyKey)
      .map(({ index, kind, property }) => Object.freeze({ index, kind, property }))
      .toSorted((left, right) => left.index - right.index),
  );
}

/**
 * Reads the server properties `@WebSocketServer()` recorded.
 *
 * @param target - The gateway class to read.
 * @returns The frozen property list, empty when the class declares none.
 */
export function getWebSocketServerProperties(
  target: ClassToken<unknown>,
): readonly (string | symbol)[] {
  const properties =
    (Reflect.getOwnMetadata(webSocketServerPropertiesMetadataKey, target.prototype) as
      | readonly (string | symbol)[]
      | undefined) ?? [];
  return Object.freeze([...properties]);
}

function normalizeGatewayOptions(
  pathOrOptions: string | WebSocketGatewayOptions,
): WebSocketGatewayMetadata {
  if (typeof pathOrOptions === "string") {
    if (pathOrOptions.length === 0) {
      throw new TypeError("@WebSocketGateway path must be a non-empty string.");
    }
    return Object.freeze({ path: pathOrOptions });
  }

  if (typeof pathOrOptions !== "object" || pathOrOptions === null) {
    throw new TypeError("@WebSocketGateway options must be an object or a string.");
  }

  const path = pathOrOptions.path ?? "/ws";
  if (typeof path !== "string" || path.length === 0) {
    throw new TypeError("@WebSocketGateway path must be a non-empty string.");
  }

  let maxPayloadLength: number | undefined;
  if (pathOrOptions.maxPayloadLength !== undefined) {
    if (
      typeof pathOrOptions.maxPayloadLength !== "number" ||
      !Number.isSafeInteger(pathOrOptions.maxPayloadLength) ||
      pathOrOptions.maxPayloadLength <= 0
    ) {
      throw new TypeError("@WebSocketGateway maxPayloadLength must be a positive integer.");
    }
    maxPayloadLength = pathOrOptions.maxPayloadLength;
  }

  let guards: readonly ClassToken<CanActivate>[] | undefined;
  if (pathOrOptions.guards !== undefined) {
    if (!Array.isArray(pathOrOptions.guards)) {
      throw new TypeError("@WebSocketGateway guards must be an array.");
    }
    for (const guard of pathOrOptions.guards) {
      if (typeof guard !== "function") {
        throw new TypeError("@WebSocketGateway guards must contain only guard classes.");
      }
    }
    guards = Object.freeze([...pathOrOptions.guards]);
  }

  return Object.freeze({
    path,
    ...(maxPayloadLength !== undefined ? { maxPayloadLength } : {}),
    ...(guards !== undefined ? { guards } : {}),
  });
}

function createParameterDecorator(
  kind: WebSocketParameterKind,
  property?: string,
): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    if (
      typeof target === "function" ||
      propertyKey === undefined ||
      !Number.isSafeInteger(parameterIndex) ||
      parameterIndex < 0
    ) {
      throw new TypeError(
        `@${decoratorName(kind)} can only decorate an instance method parameter.`,
      );
    }

    const parameters =
      (Reflect.getOwnMetadata(webSocketParameterMetadataKey, target) as
        | readonly StoredWebSocketParameterMetadata[]
        | undefined) ?? [];
    Reflect.defineMetadata(
      webSocketParameterMetadataKey,
      Object.freeze([
        ...parameters,
        Object.freeze({
          propertyKey,
          index: parameterIndex,
          kind,
          property,
        }),
      ]),
      target,
    );
  };
}

function decoratorName(kind: WebSocketParameterKind): string {
  return kind === "message-body" ? "MessageBody" : "ConnectedSocket";
}

function isMethodOrAccessor(target: object, propertyKey: string | symbol): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
  return (
    descriptor !== undefined &&
    (typeof descriptor.value === "function" ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined)
  );
}
