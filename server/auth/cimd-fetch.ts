import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { isPublicRoutableHost } from "@better-auth/core/utils/host";

/**
 * Workers-safe fetcher for MCP Client ID Metadata Documents.
 * `@better-auth/cimd/node` cannot run on Workers, so this applies the rules we can enforce with fetch():
 * HTTPS only, GET/HEAD only, publicly routable host names only, and no redirects.
 * Workers do not support `redirect: "error"`, so any 3xx is turned into a thrown TypeError.
 */
export const fetchClientMetadataViaFetch: ClientMetadataResourceFetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url.protocol !== "https:") throw new TypeError("Client metadata must be fetched over HTTPS.");
  if (method !== "GET" && method !== "HEAD") throw new TypeError("Client metadata fetches must use GET or HEAD.");
  if (!isPublicRoutableHost(url.hostname)) throw new TypeError("Client metadata host is not publicly routable.");
  const response = await fetch(url, { ...init, method, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) throw new TypeError("Client metadata redirects are refused.");
  return response;
};
