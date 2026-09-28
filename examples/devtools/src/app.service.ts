import { Injectable } from "@aponiajs/common";

/** A service with state, so `/flow` and `/requests` have something to report. */
@Injectable()
export class AppService {
  #served = 0;

  greet(): { readonly greeting: string; readonly served: number } {
    this.#served += 1;
    return { greeting: "Hello, AponiaJS!", served: this.#served };
  }
}
