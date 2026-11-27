const healthCheckMetadataKey = Symbol.for("aponia.terminus.health-check.metadata");

/**
 * Marks a controller method as a Terminus health check endpoint.
 *
 * @returns A method decorator recording health-check metadata.
 */
export function HealthCheck(): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(healthCheckMetadataKey, true, target, propertyKey);
  };
}

/**
 * Reads whether a controller method carries `@HealthCheck()`.
 *
 * @param target - Controller prototype.
 * @param propertyKey - Method name.
 * @returns `true` when `@HealthCheck()` was applied.
 */
export function isHealthCheckMethod(target: object, propertyKey: string | symbol): boolean {
  return Reflect.getMetadata(healthCheckMetadataKey, target, propertyKey) === true;
}
