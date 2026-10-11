import { vaultProblem } from "./errors.ts";
import type { FsPort } from "./fsPort.ts";
import { listNotes } from "./notes.ts";
import type { BridgeConnection } from "./types.ts";
import * as nodePath from "path";

/**
 * Bridge search: filename/path search across connected vaults.
 *
 * Privacy by construction: it only ever sees note PATHS (FsPort has no way to read
 * file contents), it runs only while the search window is open, and nothing here
 * persists anything. The caller keeps the loaded lists in memory for the lifetime
 * of the window only.
 */

export interface SearchItem {
  connectionId: string;
  vaultLabel: string;
  /** Vault-relative, "/" separated. */
  path: string;
  /** File name without ".md". */
  name: string;
  lowerName: string;
  lowerPath: string;
}

export type VaultLoad =
  | { ok: true; items: SearchItem[]; truncated: boolean }
  | { ok: false; reason: string };

export function isSearchEnabled(connection: Pick<BridgeConnection, "includeInSearch">): boolean {
  return connection.includeInSearch !== false;
}

/** NFC + lower case, so "é" typed one way finds a filename stored the other way. */
function fold(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

export function toSearchItem(connectionId: string, vaultLabel: string, path: string): SearchItem {
  const fileName = path.split("/").pop() ?? path;
  const name = fileName.replace(/\.md$/i, "");
  return {
    connectionId,
    vaultLabel,
    path,
    name,
    lowerName: fold(name),
    lowerPath: fold(path),
  };
}

/** Lists one vault's notes for searching. Never throws: problems come back as a reason. */
export async function loadSearchableVault(fs: FsPort, connection: BridgeConnection): Promise<VaultLoad> {
  if (!(await fs.isDirectory(connection.vaultPath))) {
    return { ok: false, reason: vaultProblem("not-found", connection.label, connection.vaultPath).message };
  }
  if (!(await fs.isDirectory(nodePath.join(connection.vaultPath, ".obsidian")))) {
    return { ok: false, reason: vaultProblem("not-a-vault", connection.label, connection.vaultPath).message };
  }
  try {
    const { notes, truncated } = await listNotes(fs, connection.vaultPath);
    return {
      ok: true,
      items: notes.map((path) => toSearchItem(connection.id, connection.label, path)),
      truncated,
    };
  } catch {
    return { ok: false, reason: `Couldn't read the notes in "${connection.label}".` };
  }
}

function isSubsequence(needle: string, haystack: string): boolean {
  let n = 0;
  for (let h = 0; h < haystack.length && n < needle.length; h++) {
    if (haystack[h] === needle[n]) n++;
  }
  return n === needle.length;
}

/** Higher is better; null means this token does not match. */
function tokenScore(item: SearchItem, token: string): number | null {
  const { lowerName, lowerPath } = item;
  if (lowerName === token) return 1000;
  if (lowerName.startsWith(token)) return 800;
  const inName = lowerName.indexOf(token);
  if (inName !== -1) return 600 - Math.min(inName, 99);
  const inPath = lowerPath.indexOf(token);
  if (inPath !== -1) return 400 - Math.min(inPath, 99);
  if (isSubsequence(token, lowerName)) return 200;
  if (isSubsequence(token, lowerPath)) return 100;
  return null;
}

/**
 * Every whitespace-separated word must match (name or path, substring or fuzzy).
 * Best matches first; ties go to shorter paths. An empty query returns the first
 * `limit` items unchanged, so the window shows something useful when it opens.
 */
export function searchNotes(items: readonly SearchItem[], query: string, limit = 50): SearchItem[] {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return items.slice(0, limit);

  const scored: Array<{ item: SearchItem; score: number }> = [];
  for (const item of items) {
    let total = 0;
    let matched = true;
    for (const token of tokens) {
      const score = tokenScore(item, token);
      if (score === null) {
        matched = false;
        break;
      }
      total += score;
    }
    if (matched) scored.push({ item, score: total });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.item.path.length - b.item.path.length ||
      (a.item.path < b.item.path ? -1 : a.item.path > b.item.path ? 1 : 0),
  );
  return scored.slice(0, limit).map((s) => s.item);
}
