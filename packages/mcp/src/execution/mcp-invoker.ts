import type { ClassToken, ExecutionContext, PipeType } from "@aponiajs/common";
import { httpErrors } from "@aponiajs/platform-core";
import type { McpPrimitivePlan } from "../interfaces/mcp-plan.interface.ts";
import type { McpContext } from "../interfaces/mcp-context.interface.ts";
import { McpExecutionContext } from "./mcp-execution-context.ts";

/** The container operations the pipeline needs. @internal */
export interface McpContainer {
  resolveModuleProvider<T>(module: unknown, token: ClassToken<T>): T;
  get<T>(token: ClassToken<T>): T;
}

interface GuardLike {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

interface InterceptorLike {
  interceptBefore?(context: ExecutionContext): void | Promise<void>;
  interceptAfter?(context: ExecutionContext, response: unknown): unknown;
}

interface FilterLike {
  catch(exception: unknown, host: ExecutionContext): unknown;
}

/**
 * Runs one decorated method through the enhancer pipeline.
 *
 * Guards run first, then interceptors' before halves, then pipes, then the
 * method. After halves run in reverse. A throw consults the filters in
 * most-specific-first order.
 *
 * @internal
 */
export async function invokeMcpPrimitive(
  plan: McpPrimitivePlan,
  container: McpContainer,
  input: unknown,
  call: McpContext,
): Promise<unknown> {
  const context = new McpExecutionContext(plan.classToken, plan.handler, input, call);

  for (const token of plan.guards) {
    const guard = resolve<GuardLike>(container, plan, token as ClassToken<GuardLike>);
    if ((await guard.canActivate(context)) !== true) {
      throw httpErrors.forbidden(`MCP ${plan.kind} "${plan.name}" was refused.`);
    }
  }

  const interceptors = plan.interceptors.map((token) =>
    resolve<InterceptorLike>(container, plan, token as ClassToken<InterceptorLike>),
  );
  for (const interceptor of interceptors) {
    await interceptor.interceptBefore?.(context);
  }

  let output: unknown;
  try {
    const piped = await runPipes(plan, container, input, call);
    output = await plan.handler.call(plan.instance, piped, call);
  } catch (error) {
    const answered = await runFilters(plan, container, error, context);
    if (answered !== undefined) {
      return answered;
    }
    throw error;
  }

  for (let index = interceptors.length - 1; index >= 0; index--) {
    const replaced = await interceptors[index]?.interceptAfter?.(context, output);
    if (replaced !== undefined) {
      output = replaced;
    }
  }

  return output;
}

async function runPipes(
  plan: McpPrimitivePlan,
  container: McpContainer,
  input: unknown,
  call: McpContext,
): Promise<unknown> {
  let value = input;

  for (const pipe of plan.pipes) {
    const instance = resolvePipe(container, plan, pipe);
    value = await instance.transform(value, {
      type: "body",
      metatype: plan.metatype,
      data: call.name,
    });
  }

  return value;
}

async function runFilters(
  plan: McpPrimitivePlan,
  container: McpContainer,
  error: unknown,
  context: McpExecutionContext,
): Promise<unknown> {
  for (const token of plan.filters) {
    const filter = resolve<FilterLike>(container, plan, token as ClassToken<FilterLike>);
    const answered = await filter.catch(error, context);
    if (answered !== undefined && answered !== null) {
      return answered;
    }
  }

  return undefined;
}

function resolve<T>(container: McpContainer, plan: McpPrimitivePlan, token: ClassToken<T>): T {
  try {
    return container.resolveModuleProvider(plan.module, token);
  } catch {
    return container.get(token);
  }
}

function resolvePipe(
  container: McpContainer,
  plan: McpPrimitivePlan,
  pipe: PipeType,
): { transform(value: unknown, metadata: unknown): unknown } {
  if (typeof pipe === "function") {
    return container.resolveModuleProvider(
      plan.module,
      pipe as ClassToken<{ transform(value: unknown, metadata: unknown): unknown }>,
    );
  }

  return pipe as { transform(value: unknown, metadata: unknown): unknown };
}
