import { Body, Controller, Get, Headers, Post, Query } from "@aponiajs/common";
import { ItemStore, type StoredItem } from "./item.store.ts";
import {
  createItemSchema,
  searchItemsSchema,
  tenantHeaderSchema,
  type CreateItem,
} from "./item.model.ts";

/**
 * A rejected request answers 422 and never reaches the handler. Types come from
 * the handler's own annotations, not from schema inference.
 */
@Controller("items")
export class ItemController {
  constructor(private readonly itemStore: ItemStore) {}

  @Post("/", createItemSchema)
  create(@Body() body: CreateItem): StoredItem {
    return this.itemStore.create(body);
  }

  @Get("/", searchItemsSchema)
  search(
    @Query("term") term: string,
    @Query("take") take: number | undefined,
  ): readonly StoredItem[] {
    return this.itemStore.search(term, take ?? 10);
  }

  @Get("tenant", tenantHeaderSchema)
  readTenant(@Headers("x-tenant") tenant: string): { tenant: string } {
    return { tenant };
  }
}
