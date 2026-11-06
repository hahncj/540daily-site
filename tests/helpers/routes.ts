import { createRouterContext } from "../../app/context";
import type { Services } from "../../server/app";

type RouteFn<Args> = (args: Args) => unknown;

/**
 * Call a loader or action directly. Thrown Responses become results; `data()` results are unwrapped.
 */
export async function run<Args extends { request: Request; params: Record<string, string | undefined>; context: unknown }>(
  fn: RouteFn<Args>,
  services: Services,
  request: Request,
  params: Record<string, string | undefined> = {},
): Promise<{ status: number; data: unknown; response?: Response }> {
  try {
    const value = await fn({ request, params, context: createRouterContext(services) } as unknown as Args);
    if (value instanceof Response) return { status: value.status, data: null, response: value };
    const maybe = value as { type?: string; data?: unknown; init?: { status?: number } } | null;
    if (maybe && maybe.type === "DataWithResponseInit") return { status: maybe.init?.status ?? 200, data: maybe.data };
    return { status: 200, data: value };
  } catch (thrown) {
    if (thrown instanceof Response) return { status: thrown.status, data: await thrown.clone().text(), response: thrown };
    throw thrown;
  }
}
