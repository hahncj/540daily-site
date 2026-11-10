import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { sql } from "drizzle-orm";
import type { Database } from "./adapters/db";
import type { MediaStore } from "./adapters/media";
import { createAttachmentsRepository } from "./adapters/attachments-repo";
import { createAuditRepository, createPublishingFailuresRepository } from "./adapters/audit-repo";
import { createCategoriesRepository, createTagsRepository } from "./adapters/categories-repo";
import { createMarkdownRenderer } from "./adapters/markdown";
import { createMembersRepository } from "./adapters/members-repo";
import { createPublicationsRepository } from "./adapters/publications-repo";
import { createSearchRepository } from "./adapters/search-repo";
import { createAgents, type Agents } from "./agent-auth";
import { createApiKeys, type ApiKeys } from "./api-keys";
import { handleApiV1 } from "./api-v1";
import { AUTH_BASE_PATH, createAuth, MCP_PATH, type Auth, type GoogleTestOverrides } from "./auth/auth";
import type { AppConfig } from "./config";
import { createAttachments, type Attachments } from "./core/attachments";
import { createAudit, type Audit } from "./core/audit";
import { createCategories, createHomepage, createTags, type Categories, type Homepage, type Tags } from "./core/categories";
import type { MarkdownRenderer } from "./core/markdown";
import { createMembers, type Members } from "./core/members";
import { createPublications, type Publications } from "./core/publications";
import { createPublishingFailures, type PublishingFailures } from "./core/publishing-failures";
import { createSearch, type Search } from "./core/search";
import { ATTACHMENTS_PREFIX, serveAttachment } from "./media-routes";
import { handleMcp } from "./mcp/endpoint";
import { planned, type PlannedService } from "./planned";
import { createRateLimits, type RateLimits } from "./rate-limits";

/**
 * Everything a request needs. Built per request on Workers (including the Better Auth instance);
 * only parsed config is cached. Later stages replace each `PlannedService` with the real service
 * from `server/core/`, wired here.
 */
export interface Services {
  config: AppConfig;
  db: Database;
  auth: Auth;
  media: MediaStore;
  now: () => Date;
  newId: () => string;

  /** Membership gate, current role and status (Stage 0). */
  members: Members;

  // Stage 1: publishing core
  publications: Publications;
  categories: Categories;
  tags: Tags;
  homepage: Homepage;
  search: Search;
  attachments: Attachments;
  markdown: MarkdownRenderer;
  audit: Audit;
  publishingFailures: PublishingFailures;
  // Lane 2A: agent interfaces
  apiKeys: ApiKeys;
  agents: Agents;
  rateLimits: RateLimits;
  // Lane 3A: owner console
  invitations: PlannedService<"invitations">;
  // Lane 3B: reader features
  preferences: PlannedService<"preferences">;
  bookmarks: PlannedService<"bookmarks">;
}

export interface HostDeps {
  config: AppConfig;
  db: Database;
  media: MediaStore;
  fetchClientMetadata: ClientMetadataResourceFetch;
  /** Tests inject these. */
  now?: () => Date;
  newId?: () => string;
  /** Tests only: see GoogleTestOverrides. */
  googleTestOverrides?: GoogleTestOverrides;
}

export function createServices(deps: HostDeps): Services {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const members = createMembers({ repo: createMembersRepository(deps.db), ownerEmail: deps.config.ownerEmail, now, newId });
  const auth = createAuth({
    config: deps.config,
    db: deps.db,
    members,
    fetchClientMetadata: deps.fetchClientMetadata,
    googleTestOverrides: deps.googleTestOverrides,
  });

  const audit = createAudit({ repo: createAuditRepository(deps.db), now, newId });
  const publishingFailures = createPublishingFailures({ repo: createPublishingFailuresRepository(deps.db), now, newId });
  const markdown = createMarkdownRenderer();
  const attachments = createAttachments({ repo: createAttachmentsRepository(deps.db), storage: deps.media, audit, now, newId });
  const categoriesRepo = createCategoriesRepository(deps.db);
  const publications = createPublications({
    repo: createPublicationsRepository(deps.db),
    attachments,
    markdown,
    audit,
    failures: publishingFailures,
    now,
    newId,
  });

  return {
    config: deps.config,
    db: deps.db,
    auth,
    media: deps.media,
    now,
    newId,
    members,
    publications,
    categories: createCategories({ repo: categoriesRepo }),
    tags: createTags({ repo: createTagsRepository(deps.db) }),
    homepage: createHomepage({ repo: categoriesRepo, audit, now }),
    search: createSearch({ repo: createSearchRepository(deps.db) }),
    attachments,
    markdown,
    audit,
    publishingFailures,
    apiKeys: createApiKeys({ db: deps.db, audit, now, newId }),
    agents: createAgents({ db: deps.db, audit, now }),
    rateLimits: createRateLimits({ db: deps.db, config: deps.config, now }),
    invitations: planned("invitations", "lane 3A"),
    preferences: planned("preferences", "lane 3B"),
    bookmarks: planned("bookmarks", "lane 3B"),
  };
}

export type RenderPage = (request: Request, services: Services) => Promise<Response>;

/** Paths that must not be indexed. Public pages stay indexable: no site-wide noindex. */
const PRIVATE_PATH = /^\/(sign-in|consent|dashboard|saved|account|editor|owner|api|mcp)(\/|$)/;

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Dispatch order: /health → Better Auth → /mcp → /api/v1 → /attachments → React Router.
 */
export async function handleRequest(request: Request, services: Services, renderPage: RenderPage): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  let response: Response;

  if (path === "/health") {
    response = await health(services);
  } else if (path === AUTH_BASE_PATH || path.startsWith(`${AUTH_BASE_PATH}/`) || path.startsWith("/.well-known/")) {
    response = await services.auth.handler(request);
  } else if (path === MCP_PATH) {
    response = await handleMcp(request, services);
  } else if (path === "/api/v1" || path.startsWith("/api/v1/")) {
    response = await handleApiV1(request, services);
  } else if ((request.method === "GET" || request.method === "HEAD") && path.startsWith(ATTACHMENTS_PREFIX)) {
    response = await serveAttachment(request, services);
  } else {
    response = await renderPage(request, services);
  }

  // Copy so headers are mutable (fetch() responses can have immutable headers).
  const out = new Response(response.body, response);
  if (PRIVATE_PATH.test(path)) out.headers.set("X-Robots-Tag", "noindex");
  return out;
}

async function health(services: Services): Promise<Response> {
  const checks = { database: "ok", media: "ok" } as Record<"database" | "media", "ok" | "failed">;
  try {
    await services.db.run(sql`select 1`);
  } catch {
    checks.database = "failed";
  }
  try {
    await services.media.ping();
  } catch {
    checks.media = "failed";
  }
  const ok = checks.database === "ok" && checks.media === "ok";
  return Response.json({ ok, host: services.config.host, checks }, { status: ok ? 200 : 503, headers: NO_STORE });
}
