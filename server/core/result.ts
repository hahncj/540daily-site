// Discriminated results for operations that can fail. Protocol layers map `status` to HTTP codes or MCP errors.

export type FailureStatus =
  | "invalid" // 422: field validation
  | "forbidden" // 403
  | "not_found" // 404 (also used to avoid revealing private items)
  | "conflict" // 409: duplicate payload or stale revision
  | "too_large" // 413
  | "unavailable"; // 503: dependency failed; safe to retry

export type FieldErrors = Record<string, string[]>;

export type Failure = { ok: false; status: FailureStatus; message: string; errors?: FieldErrors; currentRevision?: number };
export type Success<T> = { ok: true; value: T };
export type Result<T> = Success<T> | Failure;

export const ok = <T>(value: T): Success<T> => ({ ok: true, value });

export function fail(status: FailureStatus, message: string, extra: Pick<Failure, "errors" | "currentRevision"> = {}): Failure {
  return { ok: false, status, message, ...extra };
}

/** Suggested HTTP status for each failure (REQUIREMENTS.md section 9). */
export const HTTP_STATUS: Record<FailureStatus, number> = {
  invalid: 422,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  unavailable: 503,
};

/** Flatten zod-style issues into `{ "path.to.field": [messages] }`. */
export function fieldErrors(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
