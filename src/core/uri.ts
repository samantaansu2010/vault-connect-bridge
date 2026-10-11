/**
 * Builds the documented Obsidian URI that opens a file by absolute path:
 * Obsidian looks for the registered vault that contains that path. Using the
 * absolute path avoids vault-name collisions and needs no obsidian.json access.
 */
export function buildObsidianOpenUri(absoluteFilePath: string): string {
  return "obsidian://open?path=" + encodeURIComponent(absoluteFilePath);
}
