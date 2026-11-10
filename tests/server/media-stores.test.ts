// MediaStore adapters. R2 is exercised against a small in-memory fake of the R2Bucket binding
// (no workerd or Cloudflare account involved); the filesystem store uses a temp folder.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { R2MediaStore } from "../../hosting/cloudflare/r2-media";
import { FsMediaStore } from "../../hosting/node/fs-media";
import { PNG_BYTES, streamText } from "../helpers/publishing";

function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>();
  const bucket = {
    async put(key: string, body: Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
      objects.set(key, { bytes: new Uint8Array(body), contentType: opts?.httpMetadata?.contentType });
    },
    async get(key: string) {
      const o = objects.get(key);
      if (!o) return null;
      return { body: new Blob([o.bytes as Uint8Array<ArrayBuffer>]).stream(), size: o.bytes.byteLength, httpMetadata: { contentType: o.contentType } };
    },
    async delete(key: string) {
      objects.delete(key);
    },
    async list() {
      return { objects: [] };
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

describe("R2MediaStore (fake binding)", () => {
  it("stores, reads with the content type, deletes, and pings", async () => {
    const { bucket, objects } = fakeBucket();
    const store = new R2MediaStore(bucket);
    await store.put("attachments/a1", PNG_BYTES, "image/png");
    const got = await store.get("attachments/a1");
    expect(got).toMatchObject({ contentType: "image/png", size: PNG_BYTES.byteLength });
    expect(await streamText(got!.body)).toEqual(PNG_BYTES);
    await store.ping();
    await store.delete("attachments/a1");
    expect(objects.size).toBe(0);
    expect(await store.get("attachments/a1")).toBeNull();
  });
});

describe("FsMediaStore", () => {
  let dir = "";
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("round-trips bytes and refuses keys that escape the root", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "540daily-media-test-"));
    const store = new FsMediaStore(dir);
    await store.ping();
    await store.put("attachments/a1", PNG_BYTES, "image/png");
    const got = await store.get("attachments/a1");
    expect(got?.contentType).toBe("image/png");
    expect(await streamText(got!.body)).toEqual(PNG_BYTES);
    for (const key of ["../outside", "attachments/../../x", "/etc/passwd", "a\\b", ""]) {
      await expect(store.put(key, PNG_BYTES, "image/png"), key).rejects.toThrow("Invalid media key.");
    }
    await store.delete("attachments/a1");
    expect(await store.get("attachments/a1")).toBeNull();
  });
});
