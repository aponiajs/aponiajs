import { Injectable } from "@aponiajs/common";

/** The application state a tool reads, to show injection reaching a handler. */
@Injectable()
export class AppService {
  /** Returns the sentence the `describe_application` tool answers. */
  describe(): string {
    return "An AponiaJS application serving a Model Context Protocol endpoint.";
  }
}
