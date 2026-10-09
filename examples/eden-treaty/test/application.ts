import { treaty } from "@elysia/eden";
import { app } from "../src/main.ts";

export function createEdenClient() {
  return treaty(app);
}
