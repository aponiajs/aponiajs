import { Injectable } from "@aponiajs/common";

/** A service holding state, so the singleton's counter grows across requests. */
@Injectable()
export class AppService {
  #served = 0;

  greet(): { readonly greeting: string; readonly served: number } {
    this.#served += 1;
    return { greeting: "Hello, AponiaJS!", served: this.#served };
  }
}
