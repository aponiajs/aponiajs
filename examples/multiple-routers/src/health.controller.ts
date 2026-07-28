import { Controller, Get } from "@aponiajs/common";

/** A second router, mounted beside the catalog one under its own prefix. */
@Controller("health")
export class HealthController {
  @Get()
  read(): { status: string } {
    return { status: "ok" };
  }

  @Get("ready")
  readReadiness(): { ready: boolean } {
    return { ready: true };
  }
}
