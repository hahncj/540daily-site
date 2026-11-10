// Publishing test helpers. Every identity and publication here is test data, not real news.
import type { Role } from "../../server/core/access";
import type { AgentActor, MemberActor } from "../../server/core/actors";
import type { Services } from "../../server/app";
import { createMember } from "./services";

/** A controllable clock for createTestServices({ now }). */
export function testClock(start = "2026-11-06T15:00:00.000Z") {
  let t = new Date(start).getTime();
  return {
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
    set(iso: string) {
      t = new Date(iso).getTime();
    },
  };
}

export async function memberActor(services: Services, email: string, role: Role = "editor"): Promise<MemberActor> {
  const userId = await createMember(services, email, role);
  return { kind: "member", userId, role };
}

export function agentFor(member: { userId: string; role: Role }, credential: Partial<Pick<AgentActor, "credentialKind" | "credentialId" | "label">> = {}): AgentActor {
  return {
    kind: "agent",
    userId: member.userId,
    role: member.role,
    credentialKind: credential.credentialKind ?? "api_key",
    credentialId: credential.credentialId ?? "test-key-1",
    label: credential.label ?? "Test agent",
  };
}

let counter = 0;
/** A valid create payload (test data). */
export function storyInput(overrides: Record<string, unknown> = {}) {
  counter++;
  return {
    externalId: `test-item-${counter}`,
    type: "story",
    title: `Test story ${counter}`,
    summary: "Test summary (test data).",
    category: "Technology",
    ...overrides,
  };
}

export function reportInput(overrides: Record<string, unknown> = {}) {
  return storyInput({ type: "report", title: "Test report", bodyMarkdown: "## Overview\nTest report body (test data).", ...overrides });
}

/** Minimal valid-signature image bytes (not decodable images; only the magic bytes matter). */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0]);
export const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
export const SVG_BYTES = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

/** Prepare and complete an upload; returns the attachment ID. */
export async function uploadImage(services: Services, actor: MemberActor | AgentActor, bytes: Uint8Array = PNG_BYTES, mimeType = "image/png", altText = "Test chart") {
  const ticket = await services.attachments.prepareUpload(actor, { mimeType, size: bytes.byteLength, altText });
  if (!ticket.ok) throw new Error(`prepareUpload failed: ${ticket.message}`);
  const done = await services.attachments.completeUpload(ticket.value.token, bytes);
  if (!done.ok) throw new Error(`completeUpload failed: ${done.message}`);
  return ticket.value.attachmentId;
}

export async function streamText(stream: ReadableStream) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
