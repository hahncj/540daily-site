import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MediaStore } from "../../server/adapters/media";

/** Folder-backed MediaStore for the Node test host. Keys may not escape the root folder. */
export class FsMediaStore implements MediaStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string) {
    if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("Invalid media key.");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid media key.");
    return full;
  }

  async put(key: string, body: ArrayBuffer | Uint8Array, contentType: string) {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body instanceof Uint8Array ? body : new Uint8Array(body));
    await writeFile(`${file}.type`, contentType);
  }

  async get(key: string) {
    const file = this.resolve(key);
    try {
      const [bytes, contentType, info] = await Promise.all([readFile(file), readFile(`${file}.type`, "utf8"), stat(file)]);
      return { body: new Blob([bytes]).stream(), contentType, size: info.size };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    const file = this.resolve(key);
    await rm(file, { force: true });
    await rm(`${file}.type`, { force: true });
  }

  async ping() {
    await mkdir(this.root, { recursive: true });
  }
}
