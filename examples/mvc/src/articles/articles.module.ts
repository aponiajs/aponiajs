import { Module } from "@aponiajs/common";
import { ArticlesController } from "./articles.controller.ts";
import { ArticlesService } from "./articles.service.ts";

@Module({
  controllers: [ArticlesController],
  providers: [ArticlesService],
})
export class ArticlesModule {}
