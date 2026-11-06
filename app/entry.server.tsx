import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";
import { renderToReadableStream } from "react-dom/server";

export const streamTimeout = 5_000;

// renderToReadableStream works on both Workers and the Node test host.
export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  _loadContext: RouterContextProvider,
) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  let shellRendered = false;
  const body = await renderToReadableStream(<ServerRouter context={routerContext} url={request.url} />, {
    signal: AbortSignal.timeout(streamTimeout + 1000),
    onError(error: unknown) {
      responseStatusCode = 500;
      if (shellRendered) console.error(error);
    },
  });
  shellRendered = true;

  // Wait for the full document: pages are server-rendered for readers and crawlers alike.
  await body.allReady;

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, { headers: responseHeaders, status: responseStatusCode });
}
