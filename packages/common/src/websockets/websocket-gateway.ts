import "reflect-metadata";
import type { ClassToken } from "../tokens/token.types.ts";
import type {
  WebSocketGatewayMetadata,
  WebSocketGatewayOptions,
  WebSocketMessageMetadata,
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

export function WebSocketGateway(): ClassDecorator;
export function WebSocketGateway(path: string): ClassDecorator;
export function WebSocketGateway(options: WebSocketGatewayOptions): ClassDecorator;
export function WebSocketGateway(
  pathOrOptions: string | WebSocketGatewayOptions = {},
): ClassDecorator {
  const path = normalizeGatewayPath(pathOrOptions);
  const metadata: WebSocketGatewayMetadata = Object.freeze({ path });

  return (target) => {
    if (typeof target !== "function") {
      throw new TypeError("@WebSocketGateway can only decorate a class.");
    }

    Reflect.defineMetadata(webSocketGatewayMetadataKey, metadata, target);
  };
}

export function SubscribeMessage(event: string): MethodDecorator {
  if (typeof event !== "string" || event.trim().length === 0) {
    throw new TypeError("@SubscribeMessage requires a non-empty event name.");
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
    Reflect.defineMetadata(
      webSocketMessageMetadataKey,
      Object.freeze([
        ...messages,
        Object.freeze({
          event,
          propertyKey,
        }),
      ]),
      target,
    );
  };
}

/** Injects the incoming message data, or one of its properties. */
export function MessageBody(property?: string): ParameterDecorator {
  if (property !== undefined && typeof property !== "string") {
    throw new TypeError("@MessageBody property must be a string.");
  }

  return createParameterDecorator("message-body", property);
}

/** Injects the native client associated with the incoming message. */
export function ConnectedSocket(): ParameterDecorator {
  return createParameterDecorator("connected-socket");
}

/** Injects the platform WebSocket server into a gateway property. */
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

export function getWebSocketGatewayMetadata(
  target: ClassToken<unknown>,
): Readonly<WebSocketGatewayMetadata> | undefined {
  return Reflect.getOwnMetadata(webSocketGatewayMetadataKey, target) as
    | Readonly<WebSocketGatewayMetadata>
    | undefined;
}

export function getWebSocketMessageMetadata(
  target: ClassToken<unknown>,
): readonly WebSocketMessageMetadata[] {
  const messages =
    (Reflect.getOwnMetadata(webSocketMessageMetadataKey, target.prototype) as
      | readonly WebSocketMessageMetadata[]
      | undefined) ?? [];
  return Object.freeze([...messages]);
}

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

export function getWebSocketServerProperties(
  target: ClassToken<unknown>,
): readonly (string | symbol)[] {
  const properties =
    (Reflect.getOwnMetadata(webSocketServerPropertiesMetadataKey, target.prototype) as
      | readonly (string | symbol)[]
      | undefined) ?? [];
  return Object.freeze([...properties]);
}

function normalizeGatewayPath(pathOrOptions: string | WebSocketGatewayOptions): string {
  const path = typeof pathOrOptions === "string" ? pathOrOptions : pathOrOptions.path;
  if (path === undefined) {
    return "/ws";
  }
  if (typeof path !== "string" || path.length === 0) {
    throw new TypeError("@WebSocketGateway path must be a non-empty string.");
  }
  return path;
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
