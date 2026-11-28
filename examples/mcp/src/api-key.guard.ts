import { Injectable, type CanActivate, type ExecutionContext } from "@aponiajs/common";

/** The guard every MCP call runs before the tool method. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const platform = context.switchToHttp().getRequest() as { request?: Request };
    const token = Bun.env.MCP_TOKEN ?? "aponia-example-token";
    return (
      token.length > 0 && platform?.request?.headers.get("authorization") === `Bearer ${token}`
    );
  }
}
