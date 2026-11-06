import { z } from "zod";

const envSchema = z.object({
  PUBLIC_BASE_URL: z.url(),
  OWNER_EMAIL: z.string().trim().pipe(z.email("OWNER_EMAIL must be the owner's Google email")),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  CLIENT_IP_HEADER: z.string().min(1).optional(),
  RATE_LIMIT_REQUESTS_PER_MIN: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WRITES_PER_MIN: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_UPLOADS_PER_MIN: z.coerce.number().int().positive().default(5),
});

export type HostKind = "cloudflare" | "node";

export interface AppConfig {
  /** Origin with no trailing slash, for example https://540daily.com. */
  baseUrl: string;
  /** Lower-cased owner email; bootstraps the single owner. */
  ownerEmail: string;
  authSecret: string;
  google: { clientId: string; clientSecret: string };
  host: HostKind;
  clientIpHeaders: string[];
  rateLimits: { requests: number; writes: number; uploads: number };
}

/** Parse deployment values once, in the host entry. Throws one readable error listing every bad variable. */
export function loadConfig(env: Record<string, unknown>, host: HostKind): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join("\n  ")}`);
  }
  const v = parsed.data;
  return {
    baseUrl: v.PUBLIC_BASE_URL.replace(/\/+$/, ""),
    ownerEmail: v.OWNER_EMAIL.trim().toLowerCase(),
    authSecret: v.BETTER_AUTH_SECRET,
    google: { clientId: v.GOOGLE_CLIENT_ID, clientSecret: v.GOOGLE_CLIENT_SECRET },
    host,
    clientIpHeaders: [v.CLIENT_IP_HEADER ?? (host === "cloudflare" ? "cf-connecting-ip" : "x-forwarded-for")],
    rateLimits: {
      requests: v.RATE_LIMIT_REQUESTS_PER_MIN,
      writes: v.RATE_LIMIT_WRITES_PER_MIN,
      uploads: v.RATE_LIMIT_UPLOADS_PER_MIN,
    },
  };
}
