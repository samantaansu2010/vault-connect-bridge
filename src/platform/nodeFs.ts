import { promises as fs } from "fs";
import type { FsPort } from "../core/fsPort.ts";

/** Read-only Node `fs` adapter. Desktop only; this is the one place real disk access lives. */
export const nodeFs: FsPort = {
  async isDirectory(path) {
    try {
      return (await fs.stat(path)).isDirectory();
    } catch {
      return false;
    }
  },
  async isFile(path) {
    try {
      return (await fs.stat(path)).isFile();
    } catch {
      return false;
    }
  },
  async readdir(path) {
    const entries = await fs.readdir(path, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      isFile: e.isFile(),
      isSymlink: e.isSymbolicLink(),
    }));
  },
};
