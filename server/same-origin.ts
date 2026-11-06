const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF guard for cookie-authenticated writes: the Origin header must equal PUBLIC_BASE_URL's origin.
 * Without an Origin header, `Sec-Fetch-Site: same-origin` is accepted. Anything else is refused.
 */
export function isSameOriginWrite(request: Request, baseUrl: string): boolean {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return true;
  const expected = new URL(baseUrl).origin;
  const origin = request.headers.get("origin");
  if (origin) return origin === expected;
  return request.headers.get("sec-fetch-site") === "same-origin";
}
