/** Attachment byte storage. R2 on Workers, a folder for the Node test host, memory in Vitest. */
export interface MediaStore {
  put(key: string, body: ArrayBuffer | Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream; contentType: string; size: number } | null>;
  delete(key: string): Promise<void>;
  /** Cheap reachability check for /health. Throws when unavailable. */
  ping(): Promise<void>;
}
