import type { MediaStore } from "../../server/adapters/media";

export class R2MediaStore implements MediaStore {
  constructor(private readonly bucket: R2Bucket) {}

  async put(key: string, body: ArrayBuffer | Uint8Array, contentType: string) {
    await this.bucket.put(key, body, { httpMetadata: { contentType } });
  }

  async get(key: string) {
    const object = await this.bucket.get(key);
    if (!object) return null;
    return {
      body: object.body as ReadableStream,
      contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
      size: object.size,
    };
  }

  async delete(key: string) {
    await this.bucket.delete(key);
  }

  async ping() {
    await this.bucket.list({ limit: 1 });
  }
}
