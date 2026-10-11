import * as path from "path";
import type { DirEntry, FsPort } from "../../src/core/fsPort.ts";

type Kind = "file" | "dir" | "symlink";

/**
 * In-memory read-only filesystem for tests.
 *
 * Every incoming path is normalized with Node's native `path.resolve`, exactly
 * like the production code does, so fixtures written as "/vaults/research" match
 * on Windows ("D:\vaults\research") and on POSIX alike.
 */
export class MemFs implements FsPort {
  private nodes = new Map<string, Kind>();

  constructor(spec: { files?: string[]; dirs?: string[]; symlinks?: string[] } = {}) {
    for (const d of spec.dirs ?? []) this.addDir(d);
    for (const f of spec.files ?? []) this.addEntry(f, "file");
    for (const s of spec.symlinks ?? []) this.addEntry(s, "symlink");
  }

  private norm(p: string): string {
    return path.resolve(p);
  }

  private addEntry(p: string, kind: Kind): void {
    const abs = this.norm(p);
    this.addDir(path.dirname(abs));
    this.nodes.set(abs, kind);
  }

  private addDir(p: string): void {
    let current = this.norm(p);
    for (;;) {
      this.nodes.set(current, "dir");
      const parent = path.dirname(current);
      if (parent === current) break; // filesystem root
      current = parent;
    }
  }

  async isDirectory(p: string): Promise<boolean> {
    return this.nodes.get(this.norm(p)) === "dir";
  }

  async isFile(p: string): Promise<boolean> {
    return this.nodes.get(this.norm(p)) === "file";
  }

  async readdir(p: string): Promise<DirEntry[]> {
    const dir = this.norm(p);
    if (this.nodes.get(dir) !== "dir") throw new Error(`ENOTDIR: ${p}`);
    const out: DirEntry[] = [];
    for (const [key, kind] of this.nodes) {
      if (key !== dir && path.dirname(key) === dir) {
        out.push({
          name: path.basename(key),
          isDirectory: kind === "dir",
          isFile: kind === "file",
          isSymlink: kind === "symlink",
        });
      }
    }
    return out;
  }
}
