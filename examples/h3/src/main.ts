import { AponiaFactory } from "@aponiajs/platform-h3";
import { AppModule } from "./app.module.ts";

const port = Number(process.env.PORT ?? 3002);
const application = await AponiaFactory.create(AppModule, { prefix: "/api" });
await application.listen(port);

console.log(`[@aponiajs/example-h3] listening on ${application.getUrl()}/api`);
