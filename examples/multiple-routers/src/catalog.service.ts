import { Injectable } from "@aponiajs/common";
export interface CatalogItem {
  readonly id: string;
  readonly name: string;
  readonly quantity: number;
}

/** Business behavior lives in a service; controllers only delegate to it. */
@Injectable()
export class CatalogService {
  readonly #items = new Map<string, CatalogItem>();

  create(item: Omit<CatalogItem, "id">): CatalogItem {
    const created: CatalogItem = { id: String(this.#items.size + 1), ...item };
    this.#items.set(created.id, created);
    return created;
  }

  replace(id: string, item: Omit<CatalogItem, "id">): CatalogItem {
    const replaced: CatalogItem = { id, ...item };
    this.#items.set(id, replaced);
    return replaced;
  }

  remove(id: string): boolean {
    return this.#items.delete(id);
  }

  findOne(id: string): CatalogItem | undefined {
    return this.#items.get(id);
  }

  search(term: string, take: number): readonly CatalogItem[] {
    return [...this.#items.values()]
      .filter((item) => item.name.toLowerCase().includes(term.toLowerCase()))
      .slice(0, take);
  }

  describe(): string {
    return "The catalog holds every item this example serves.";
  }
}
