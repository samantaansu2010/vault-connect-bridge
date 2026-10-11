import { buildBridgeLink, encodePart, findBridgeLinks, parseBridgeLink } from "./linkParser.ts";
import type { FoundLink, ParseResult } from "./linkParser.ts";

/**
 * EXPERIMENTAL second link format that uses Obsidian's own, public protocol
 * handler instead of intercepting bridge:// links:
 *
 *   obsidian://vault-connect-bridge?vault=<source vault>&id=<connection id>&path=<note path>[&anchor=<heading>]
 *
 * It is converted to the canonical bridge:// form and goes through the very same
 * parser, resolver and navigation, so every safety check (no "..", no absolute
 * paths, no encoded slashes) applies identically.
 */

export const PROTOCOL_ACTION = "vault-connect-bridge";

/** Builds a Markdown-safe obsidian:// link. `vaultName` is the vault the link lives in. */
export function buildProtocolLink(
  vaultName: string,
  connectionId: string,
  notePath: string,
  anchor?: string | null,
): string {
  const url =
    `obsidian://${PROTOCOL_ACTION}?vault=${encodePart(vaultName)}` +
    `&id=${encodePart(connectionId)}&path=${encodePart(notePath)}` +
    (anchor ? `&anchor=${encodePart(anchor)}` : "");
  const check = parseProtocolLink(url);
  if (!check.ok) throw new Error(`Cannot build a protocol link for "${notePath}" (${check.reason}).`);
  return url;
}

/** Validates already-decoded parameters by round-tripping through the strict bridge:// parser. */
export function protocolParamsToLink(params: Record<string, string | undefined>): ParseResult {
  const { id, path, anchor } = params;
  if (!id || !path) return { ok: false, reason: "malformed" };
  const encodedPath = path.split("/").map(encodePart).join("/");
  const canonical = `bridge://${id}/${encodedPath}` + (anchor ? `#${encodePart(anchor)}` : "");
  return parseBridgeLink(canonical);
}

export function parseProtocolLink(input: string): ParseResult {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, reason: "not-bridge" };
  }
  if (url.protocol !== "obsidian:" || url.hostname.toLowerCase() !== PROTOCOL_ACTION) {
    return { ok: false, reason: "not-bridge" };
  }
  return protocolParamsToLink({
    id: url.searchParams.get("id") ?? undefined,
    path: url.searchParams.get("path") ?? undefined,
    anchor: url.searchParams.get("anchor") ?? undefined,
  });
}

/** Either link format in, canonical bridge:// URL out (or null if it is neither). */
export function toBridgeUrl(url: string): string | null {
  const parsed = parseAnyBridgeLink(url);
  if (!parsed.ok) return null;
  return buildBridgeLink(parsed.link.connectionId, parsed.link.path, parsed.link.anchor);
}

export function parseAnyBridgeLink(url: string): ParseResult {
  const direct = parseBridgeLink(url);
  return direct.ok || direct.reason !== "not-bridge" ? direct : parseProtocolLink(url);
}

/** Finds Markdown links in either format. Unrelated obsidian:// links are ignored. */
export function findLinks(text: string): FoundLink[] {
  return findBridgeLinks(text, (url) => parseAnyBridgeLink(url).ok || /^bridge:\/\//i.test(url.trim()));
}
