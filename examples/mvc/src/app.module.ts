import { Module } from "@aponiajs/common";
import { ViewModule } from "@aponiajs/view";
import { ArticlesModule } from "./articles/articles.module.ts";

@Module({
  imports: [
    ViewModule.register({
      defaultEngine: "blade",
      rootDir: new URL("./", import.meta.url).pathname,
    }),
    ArticlesModule,
  ],
})
export class AppModule {}
