import {
  AponiaError,
  MESSAGE_HANDLER_ERROR_CODE,
  UNKNOWN_MESSAGE_PATTERN_CODE,
  getMessagePatternMetadata,
  getMessagePayloadProperty,
  getTokenName,
  messageFailure,
  type ControllerDefinition,
  type LoggerService,
  type MessagePatternKind,
  type MicroserviceHandler,
  type MicroserviceReply,
  type MicroserviceTransport,
} from "@aponiajs/common";
import { reportThroughLogger } from "../errors/default-exception-filter.ts";

interface MicroserviceBinding {
  readonly pattern: string;
  readonly kind: MessagePatternKind;
  readonly controller: string;
  readonly propertyKey: string | symbol;
  readonly invoke: (data: unknown) => unknown;
}

/** The compiled message handlers one boot dispatches to. */
export type MicroserviceHandlerTable = Map<string, MicroserviceBinding>;

/** The running transports one boot owns. */
export interface MicroserviceRuntime {
  readonly transports: readonly string[];
  /** Stops every transport; failures are reported, never thrown. */
  close(): Promise<void>;
}

/**
 * Collects one controller's message handlers into the boot's table.
 *
 * Handlers are read from the controller class the same way routes are: the
 * decorators wrote metadata on the prototype, and this compiles the payload
 * binding once instead of per message. A pattern two controllers claim is
 * refused here, before any transport exists, because which handler answers is
 * a boot decision and must not depend on delivery order.
 *
 * @internal
 */
export function collectMessageHandlers(
  handlers: MicroserviceHandlerTable,
  controller: ControllerDefinition,
  instance: unknown,
): void {
  const prototype = controller.useClass.prototype;
  const declared = getMessagePatternMetadata(prototype);
  if (declared.size === 0) {
    return;
  }
  const controllerName = getTokenName(controller.token);
  for (const [propertyKey, metadata] of declared) {
    const method = (instance as Record<string | symbol, unknown>)[propertyKey];
    if (typeof method !== "function") {
      throw new AponiaError(
        "INVALID_CONTROLLER",
        `Message handler "${String(propertyKey)}" is not a method of "${controllerName}".`,
        { controller: controllerName, propertyKey: String(propertyKey) },
      );
    }
    const previous = handlers.get(metadata.pattern);
    if (previous !== undefined) {
      throw new AponiaError(
        "DUPLICATE_MESSAGE_PATTERN",
        `Message pattern "${metadata.pattern}" is declared by "${previous.controller}" and "${controllerName}".`,
        Object.freeze({
          pattern: metadata.pattern,
          controllers: Object.freeze([previous.controller, controllerName]),
        }),
      );
    }
    const payloadProperty = getMessagePayloadProperty(prototype, propertyKey);
    handlers.set(
      metadata.pattern,
      Object.freeze({
        pattern: metadata.pattern,
        kind: metadata.kind,
        controller: controllerName,
        propertyKey,
        invoke: (data: unknown) =>
          Reflect.apply(method, instance, [readPayload(data, payloadProperty)]),
      }),
    );
  }
}

/**
 * Validates the transports and starts delivering messages.
 *
 * A transport connects after every provider and controller is initialized, so
 * the first message a broker holds cannot reach a half-built graph. When one
 * transport refuses to start, the transports already subscribed are closed and
 * the original failure propagates, because a boot that answers some of its
 * configured transports is not a boot this framework can call successful.
 *
 * @internal
 */
export async function startMicroserviceTransports(
  transports: readonly MicroserviceTransport[] | undefined,
  handlers: ReadonlyMap<string, MicroserviceBinding>,
  logger: LoggerService | undefined,
): Promise<MicroserviceRuntime | undefined> {
  const resolved = resolveTransports(transports);
  if (resolved.length === 0) {
    return undefined;
  }

  const dispatch: MicroserviceHandler = async (message) =>
    dispatchMessage(handlers, message, logger);
  const started: MicroserviceTransport[] = [];
  try {
    for (const transport of resolved) {
      await transport.subscribe(dispatch);
      started.push(transport);
    }
  } catch (error) {
    await closeTransports(started, logger);
    throw error;
  }

  const names = Object.freeze(resolved.map((transport) => transport.name));
  for (const name of names) {
    logger?.log(`${name}: subscribed to application messages`, "MicroservicesController");
  }

  return Object.freeze({
    transports: names,
    close: () => closeTransports(started, logger),
  });
}

function resolveTransports(
  transports: readonly MicroserviceTransport[] | undefined,
): readonly MicroserviceTransport[] {
  if (transports === undefined || transports.length === 0) {
    return [];
  }
  const issues: string[] = [];
  const names = new Set<string>();
  transports.forEach((transport, index) => {
    if (typeof transport?.name !== "string" || transport.name.trim() === "") {
      issues.push(`microservices[${index}].name must be a non-empty string`);
    } else if (names.has(transport.name)) {
      issues.push(`microservices[${index}] repeats the transport name "${transport.name}"`);
    } else {
      names.add(transport.name);
    }
    if (typeof transport?.subscribe !== "function") {
      issues.push(`microservices[${index}].subscribe must be a function`);
    }
    if (typeof transport?.close !== "function") {
      issues.push(`microservices[${index}].close must be a function`);
    }
  });
  if (issues.length > 0) {
    throw new AponiaError(
      "INVALID_MICROSERVICE_TRANSPORT",
      "The microservice transports are invalid.",
      { issues: Object.freeze([...issues]) },
    );
  }
  return Object.freeze([...transports]);
}

async function dispatchMessage(
  handlers: ReadonlyMap<string, MicroserviceBinding>,
  message: { readonly pattern: string; readonly data: unknown },
  logger: LoggerService | undefined,
): Promise<MicroserviceReply> {
  const binding = handlers.get(message.pattern);
  if (binding === undefined) {
    return Object.freeze({
      ok: false,
      error: messageFailure(
        UNKNOWN_MESSAGE_PATTERN_CODE,
        `No handler is registered for pattern "${message.pattern}".`,
      ),
    });
  }
  try {
    const value = await binding.invoke(message.data);
    return Object.freeze({
      ok: true as const,
      value: binding.kind === "event" ? undefined : value,
    });
  } catch (error) {
    reportThroughLogger(logger, error, "MicroservicesController");
    return Object.freeze({
      ok: false,
      error: messageFailure(MESSAGE_HANDLER_ERROR_CODE, "The message handler failed."),
    });
  }
}

async function closeTransports(
  transports: readonly MicroserviceTransport[],
  logger: LoggerService | undefined,
): Promise<void> {
  for (const transport of [...transports].reverse()) {
    try {
      await transport.close();
    } catch (error) {
      reportThroughLogger(logger, error, "MicroservicesController");
    }
  }
}

function readPayload(data: unknown, property: string | undefined): unknown {
  if (property === undefined) {
    return data;
  }
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  return (data as Record<string, unknown>)[property];
}
