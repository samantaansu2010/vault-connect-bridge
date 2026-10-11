import type { FsPort } from "./fsPort.ts";

export const MAX_NOTES = 100_000;

export interface NoteListing {
  /** Vault-relative paths with "/" separators, sorted. */
  notes: string[];
  truncated: boolean;
}

/**
 * Lists Markdown notes in a vault. Called ONLY when the user opens the link
 * picker. Skips hidden folders (.obsidian, .git, .trash, ...) and never follows
 * symlinks, so it cannot loop or leave the vault.
 */
export async function listNotes(
  fs: FsPort,
  vaultPath: string,
  options: { max?: number } = {},
): Promise<NoteListing> {
  const max = options.max ?? MAX_NOTES;
  const notes: string[] = [];
  let truncated = false;
  const pending: Array<{ abs: string; rel: string }> = [{ abs: vaultPath, rel: "" }];

  while (pending.length > 0 && !truncated) {
    const dir = pending.pop();
    if (!dir) break;
    let entries: Awaited<ReturnType<FsPort["readdir"]>>;
    try {
      entries = await fs.readdir(dir.abs);
    } catch (e) {
      if (dir.rel === "") throw e; // the vault root itself must be readable
      continue; // a locked or vanished subfolder is skipped, not fatal
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymlink) continue;
      const rel = dir.rel === "" ? entry.name : dir.rel + "/" + entry.name;
      const abs = joinPath(dir.abs, entry.name);
      if (entry.isDirectory) {
        pending.push({ abs, rel });
      } else if (entry.isFile && entry.name.toLowerCase().endsWith(".md")) {
        if (notes.length >= max) {
          truncated = true;
          break;
        }
        notes.push(rel);
      }
    }
  }

  notes.sort();
  return { notes, truncated };
}

function joinPath(base: string, name: string): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return base.endsWith(sep) ? base + name : base + sep + name;
}
