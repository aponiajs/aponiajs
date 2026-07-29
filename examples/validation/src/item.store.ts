import { Injectable } from "@aponiajs/common";
import type { CreateItem } from "./item.model.ts";

export interface StoredItem extends CreateItem {
  readonly id: string;
}

/** A tiny store, so the example asserts what the validated input became. */
@Injectable()
export class ItemStore {
  readonly #items = new Map<string, StoredItem>();

  create(item: CreateItem): StoredItem {
    const created: StoredItem = { id: String(this.#items.size + 1), ...item };
    this.#items.set(created.id, created);
    return created;
  }

  search(term: string, take: number): readonly StoredItem[] {
    return [...this.#items.values()]
      .filter((item) => item.name.toLowerCase().includes(term.toLowerCase()))
      .slice(0, take);
  }
}
