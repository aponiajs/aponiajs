export interface WebSocketGatewayOptions {
  readonly path?: string;
}

export interface WebSocketGatewayMetadata {
  readonly path: string;
}

export interface WebSocketMessageMetadata {
  readonly event: string;
  readonly propertyKey: string | symbol;
}

export type WebSocketParameterKind = "message-body" | "connected-socket";

export interface WebSocketParameterMetadata {
  readonly index: number;
  readonly kind: WebSocketParameterKind;
  readonly property: string | undefined;
}

export interface WsResponse<TData = unknown> {
  readonly event: string;
  readonly data: TData;
}

export interface OnGatewayInit<TServer = unknown> {
  afterInit(server: TServer): void | Promise<void>;
}

export interface OnGatewayConnection<TClient = unknown> {
  handleConnection(client: TClient): void | Promise<void>;
}

export interface OnGatewayDisconnect<TClient = unknown> {
  handleDisconnect(client: TClient): void | Promise<void>;
}
