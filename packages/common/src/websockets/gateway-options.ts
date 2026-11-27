/** @internal */
export function mergeGatewayOptions(
  target: {
    maxPayloadLength?: number;
    idleTimeoutSeconds?: number;
    sendPings?: boolean;
  },
  plan: {
    readonly maxPayloadLength?: number | undefined;
    readonly idleTimeoutMs?: number | undefined;
    readonly sendPings?: boolean | undefined;
  },
): void {
  if (plan.maxPayloadLength !== undefined) {
    target.maxPayloadLength =
      target.maxPayloadLength === undefined
        ? plan.maxPayloadLength
        : Math.min(target.maxPayloadLength, plan.maxPayloadLength);
  }
  if (plan.idleTimeoutMs !== undefined) {
    const seconds = Math.max(1, Math.ceil(plan.idleTimeoutMs / 1_000));
    target.idleTimeoutSeconds =
      target.idleTimeoutSeconds === undefined
        ? seconds
        : Math.min(target.idleTimeoutSeconds, seconds);
  }
  if (plan.sendPings === true) {
    target.sendPings = true;
  }
}
