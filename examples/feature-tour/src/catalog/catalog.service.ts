import { Injectable } from "@aponiajs/common";
import { ConfigService } from "../config/config.service.ts";
import type { CreateItem } from "./catalog.schema.ts";

export interface Item extends CreateItem {
  readonly id: string;
}

/** Use case: a service holding behavior, injected by constructor. */
@Injectable()
export class CatalogService {
  readonly #items = new Map<string, Item>();

  constructor(private readonly configService: ConfigService) {}

  create(item: CreateItem): Item {
    const created: Item = { id: String(this.#items.size + 1), ...item };
    this.#items.set(created.id, created);
    return created;
  }

  findOne(id: string): Item | undefined {
    return this.#items.get(id);
  }

  search(term: string, take: number): readonly Item[] {
    return [...this.#items.values()]
      .filter((item) => item.name.toLowerCase().includes(term.toLowerCase()))
      .slice(0, take);
  }

  describe(): string {
    return this.configService.greet("catalog");
  }
}
