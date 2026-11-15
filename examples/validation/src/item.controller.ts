import { Body, Controller, Get, Headers, Post, Query } from "@aponiajs/common";
import { ItemStore, type StoredItem } from "./item.store.ts";
import { CreateItem, SearchItems, TenantHeaders } from "./item.model.ts";

/**
 * A rejected request answers 422 and never reaches the handler. Types come from
 * the handler's own annotations, not from schema inference.
 */
@Controller("items")
export class ItemController {
  constructor(private readonly itemStore: ItemStore) {}

  @Post("/", { body: CreateItem })
  create(@Body() body: CreateItem): StoredItem {
    return this.itemStore.create(body);
  }

  @Get("/", { query: SearchItems })
  search(@Query() query: SearchItems): readonly StoredItem[] {
    return this.itemStore.search(query.term, query.take ?? 10);
  }

  @Get("tenant", { headers: TenantHeaders })
  readTenant(@Headers() headers: TenantHeaders): { tenant: string } {
    return { tenant: headers["x-tenant"] };
  }
}
