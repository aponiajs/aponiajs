import { AponiaFactory } from "@aponiajs/platform-hono";
import { AppModule } from "./app.module.ts";

const port = Number(process.env.PORT ?? 3001);
const application = await AponiaFactory.create(AppModule, { prefix: "/api" });
await application.listen(port);

console.log(`[@aponiajs/example-hono] listening on ${application.getUrl()}/api`);
