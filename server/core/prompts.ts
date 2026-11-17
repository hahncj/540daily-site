// Agent prompts: owner-managed instructions that agents read over MCP and HTTP (today only the daily
// story prompt). Every save appends a revision; restore copies an old revision into a new one.
// Prompts can hold private details, so only the owner and the owner's own agents may read them, and
// only the owner (on the website) may change them. Bodies never go into audit details or logs.
import { z } from "zod";
import { roleAtLeast } from "./access";
import type { Actor, MemberActor } from "./actors";
import type { Audit } from "./audit";
import { fail, fieldErrors, ok, type Result } from "./result";

export const PROMPT_KEYS = ["daily_story"] as const;
export type PromptKey = (typeof PROMPT_KEYS)[number];

export const PROMPT_TITLES: Record<PromptKey, string> = { daily_story: "Daily story prompt" };

export const MAX_PROMPT_LENGTH = 50_000;
export const MAX_PROMPT_NOTE_LENGTH = 200;
export const PROMPT_HISTORY_LIMIT = 20;

export type PromptRevision = {
  key: PromptKey;
  revision: number;
  body: string;
  note: string | null;
  createdAt: Date;
  createdByUserId: string | null;
};

export interface PromptsRepository {
  current(key: PromptKey): Promise<PromptRevision | null>;
  get(key: PromptKey, revision: number): Promise<PromptRevision | null>;
  /** Newest first. */
  history(key: PromptKey, limit: number): Promise<PromptRevision[]>;
  /** Insert `revision` only if the current revision is `revision - 1` (0 = none yet). */
  append(revision: PromptRevision): Promise<"written" | "stale">;
}

/** Owner members and the owner's own agents. */
export function canReadPrompt(actor: Actor): boolean {
  return roleAtLeast(actor.role, "owner");
}

/** The owner on the website. Agents never change prompts. */
export function canWritePrompt(actor: Actor): actor is MemberActor {
  return actor.kind === "member" && roleAtLeast(actor.role, "owner");
}

/** Form posts send CRLF; store LF so revisions compare cleanly. Surrounding blank lines are dropped. */
function normalizeBody(body: string): string {
  return body.replace(/\r\n?/g, "\n").replace(/^\s*\n|\s+$/g, "");
}

const expectedRevision = z.coerce.number().int().min(0, "Reload the page and try again.");

export const promptUpdateSchema = z.object({
  body: z
    .string()
    .transform(normalizeBody)
    .pipe(z.string().min(1, "Enter the prompt.").max(MAX_PROMPT_LENGTH, `Keep the prompt under ${MAX_PROMPT_LENGTH.toLocaleString("en-US")} characters.`)),
  note: z
    .string()
    .trim()
    .max(MAX_PROMPT_NOTE_LENGTH, `Keep the note under ${MAX_PROMPT_NOTE_LENGTH} characters.`)
    .optional()
    .transform((v) => v || null),
  expectedRevision,
});

export const promptRestoreSchema = z.object({
  revision: z.coerce.number().int().min(1),
  expectedRevision,
});

const NOT_SAVED = "No daily story prompt has been saved yet. The owner can add one in the owner console.";

export type Prompts = ReturnType<typeof createPrompts>;

export function createPrompts({ repo, audit, now }: { repo: PromptsRepository; audit: Audit; now: () => Date }) {
  async function append(actor: MemberActor, key: PromptKey, body: string, note: string | null, expected: number, action: string, extra: Record<string, unknown> = {}) {
    const current = await repo.current(key);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== expected) {
      return fail("conflict", `Someone saved revision ${currentRevision} since you loaded this page. Reload to see it.`, { currentRevision });
    }
    if (current && current.body === body) return fail("invalid", "Nothing changed: this text is already the current prompt.");
    const revision: PromptRevision = { key, revision: expected + 1, body, note, createdAt: now(), createdByUserId: actor.userId };
    const written = await repo.append(revision);
    if (written === "stale") {
      const latest = (await repo.current(key))?.revision ?? 0;
      return fail("conflict", `Someone saved revision ${latest} since you loaded this page. Reload to see it.`, { currentRevision: latest });
    }
    await audit.record(actor, action, { type: "prompt", id: key }, { revision: revision.revision, ...extra });
    return ok(revision);
  }

  return {
    /** The current revision. `not_found` until the owner first saves one. */
    async get(actor: Actor, key: PromptKey): Promise<Result<PromptRevision>> {
      if (!canReadPrompt(actor)) return fail("forbidden", "Only the owner and the owner's agents can read agent prompts.");
      const current = await repo.current(key);
      return current ? ok(current) : fail("not_found", NOT_SAVED);
    },

    /** Recent revisions, newest first. Owner only. */
    async history(actor: Actor, key: PromptKey): Promise<Result<PromptRevision[]>> {
      if (!canWritePrompt(actor)) return fail("forbidden", "Only the owner can see prompt history.");
      return ok(await repo.history(key, PROMPT_HISTORY_LIMIT));
    },

    /** Save new text as the next revision. Send `expectedRevision` (0 for the first save). */
    async update(actor: Actor, key: PromptKey, input: unknown): Promise<Result<PromptRevision>> {
      if (!canWritePrompt(actor)) return fail("forbidden", "Only the owner can change agent prompts.");
      const parsed = promptUpdateSchema.safeParse(input);
      if (!parsed.success) return fail("invalid", "Check the highlighted fields.", { errors: fieldErrors(parsed.error.issues) });
      const { body, note, expectedRevision } = parsed.data;
      return append(actor, key, body, note, expectedRevision, "prompt.update");
    },

    /** Copy an earlier revision's text into a new revision. */
    async restore(actor: Actor, key: PromptKey, input: unknown): Promise<Result<PromptRevision>> {
      if (!canWritePrompt(actor)) return fail("forbidden", "Only the owner can change agent prompts.");
      const parsed = promptRestoreSchema.safeParse(input);
      if (!parsed.success) return fail("invalid", "Choose a revision to restore.");
      const old = await repo.get(key, parsed.data.revision);
      if (!old) return fail("not_found", "That revision does not exist.");
      return append(actor, key, old.body, `Restored revision ${old.revision}`, parsed.data.expectedRevision, "prompt.restore", {
        restoredRevision: old.revision,
      });
    },
  };
}
