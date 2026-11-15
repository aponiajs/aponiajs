import { Module } from "@aponiajs/common";
import { ChatGateway } from "./chat.gateway.ts";
import { ChatService } from "./chat.service.ts";

@Module({
  providers: [ChatGateway, ChatService],
})
export class AppModule {}
