import type { Article } from "./article.model.ts";

export class ArticlesService {
  readonly #articles = new Map<string, Article>([
    ["1", { id: "1", title: "What is MVC?", content: "Model-View-Controller in AponiaJS." }],
    ["2", { id: "2", title: "Modern HTMX Flow", content: "Auto-adapting server views." }],
  ]);

  findAll(): Article[] {
    return [...this.#articles.values()];
  }

  findOne(id: string): Article | undefined {
    return this.#articles.get(id);
  }

  remove(id: string): boolean {
    return this.#articles.delete(id);
  }
}
