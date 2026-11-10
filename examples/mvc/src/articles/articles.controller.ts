import { Controller, Delete, Get, Param, Render } from "@aponiajs/common";
import { fragment, view } from "@aponiajs/view";
import { ArticlesService } from "./articles.service.ts";

@Controller("articles")
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  index() {
    const articles = this.articlesService.findAll();
    return view("articles.views.index", { title: "Articles", articles });
  }

  @Get("decorated")
  @Render("articles.views.index")
  decorated() {
    const articles = this.articlesService.findAll();
    return { title: "Articles", articles };
  }

  @Get(":id")
  show(@Param("id") id: string) {
    const article = this.articlesService.findOne(id);
    return view("articles.views.detail", { article, title: article?.title ?? "Article" });
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    this.articlesService.remove(id);
    return fragment("<p>Article deleted successfully</p>");
  }
}
