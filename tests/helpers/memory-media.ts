import type { MediaStore } from "../../server/adapters/media";

/** In-memory MediaStore for Vitest. Set `failing` to simulate an unavailable bucket. */
export class MemoryMediaStore implements MediaStore {
  readonly objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; contentType: string }>();
  failing = false;

  async put(key: string, body: ArrayBuffer | Uint8Array, contentType: string) {
    this.check();
    const bytes: Uint8Array<ArrayBuffer> = body instanceof Uint8Array ? new Uint8Array(body) : new Uint8Array(body.slice(0));
    this.objects.set(key, { bytes, contentType });
  }

  async get(key: string) {
    this.check();
    const object = this.objects.get(key);
    if (!object) return null;
    return { body: new Blob([object.bytes]).stream(), contentType: object.contentType, size: object.bytes.byteLength };
  }

  async delete(key: string) {
    this.check();
    this.objects.delete(key);
  }

  async ping() {
    this.check();
  }

  private check() {
    if (this.failing) throw new Error("Media store unavailable (test).");
  }
}
