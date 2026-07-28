import { defineModule } from "@aponiajs/common";
import { metricsModule } from "./metrics.descriptors.ts";

/**
 * The same framework without decorators: this root module is a frozen
 * descriptor, exactly what the runtime consumes.
 */
export const AppModule = defineModule({
  id: "AppModule",
  imports: [metricsModule],
});
