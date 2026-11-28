import { Inject, Injectable } from "@aponiajs/common";
import { AppConfig } from "./config.ts";

/** Reads the validated configuration the way a service does: by injection. */
@Injectable()
export class AppService {
  constructor(
    @Inject(AppConfig)
    private readonly config: { readonly port: number; readonly serviceName: string },
  ) {}

  describe(): { readonly serviceName: string; readonly port: number } {
    return { serviceName: this.config.serviceName, port: this.config.port };
  }
}
