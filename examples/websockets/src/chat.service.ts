import { Injectable } from "@aponiajs/common";

@Injectable()
export class ChatService {
  createMessage(
    clientId: string,
    text: string,
  ): {
    readonly clientId: string;
    readonly text: string;
  } {
    return Object.freeze({ clientId, text });
  }
}
