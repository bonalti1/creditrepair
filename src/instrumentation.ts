import { reportError } from "@/lib/observability/errors";

// Next.js calls this for every uncaught error in a route handler, server
// component or server action. Caught errors are reported by the code that
// catches them (see reportError call sites).
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  await reportError(error, {
    where: `${request.method} ${context.routePath || request.path}`,
    extra: { routeType: context.routeType },
  });
}
