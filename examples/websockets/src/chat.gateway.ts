import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  type WsResponse,
} from "@aponiajs/common";
import type { ElysiaWebSocket, ElysiaWebSocketServer } from "@aponiajs/platform-elysia";
import { ChatService } from "./chat.service.ts";

@WebSocketGateway("/chat")
export class ChatGateway
  implements
    OnGatewayInit<ElysiaWebSocketServer>,
    OnGatewayConnection<ElysiaWebSocket>,
    OnGatewayDisconnect<ElysiaWebSocket>
{
  @WebSocketServer()
  server!: ElysiaWebSocketServer;

  constructor(private readonly chatService: ChatService) {}

  afterInit(server: ElysiaWebSocketServer): void {
    if (server !== this.server) {
      throw new Error("The injected WebSocket server must match the lifecycle server.");
    }
  }

  handleConnection(client: ElysiaWebSocket): void {
    client.subscribe("chat");
  }

  handleDisconnect(client: ElysiaWebSocket): void {
    client.unsubscribe("chat");
  }

  @SubscribeMessage("chat.send")
  send(
    @MessageBody("text") text: string,
    @ConnectedSocket() client: ElysiaWebSocket,
  ): WsResponse<ReturnType<ChatService["createMessage"]>> {
    return {
      event: "chat.message",
      data: this.chatService.createMessage(client.id, text),
    };
  }

  @SubscribeMessage("chat.zero")
  zero(): number {
    return 0;
  }

  @SubscribeMessage("chat.fail")
  fail(): never {
    throw new Error("Internal details remain on the server.");
  }
}
