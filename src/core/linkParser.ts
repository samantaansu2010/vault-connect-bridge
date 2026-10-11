/**
 * Bridge link format:  bridge://<connection-id>/<vault-relative/path/to/note.md>[#anchor]
 * Used as the destination of a normal Markdown link: [label](bridge://...)
 */

export interface BridgeLink {
  connectionId: string;
  /** Vault-relative path using "/" separators, already decoded and validated. */
  path: string;
  /** Heading or ^block anchor, decoded. Parsed for forward compatibility. */
  anchor: string | null;
}

export type ParseFailure = "not-bridge" | "malformed" | "missing-path" | "unsafe-path";

export type ParseResult =
  | { ok: true; link: BridgeLink }
  | { ok: false; reason: ParseFailure };

export interface FoundLink {
  start: number;
  end: number;
  label: string;
  url: string;
}

const SCHEME = "bridge://";

function isBridgeUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith(SCHEME);
}
const ID_PATTERN = /^[a-f0-9]{8}$/;

export function isValidConnectionId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** encodeURIComponent plus the characters it leaves alone that break Markdown links. */
export function encodePart(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

export function buildBridgeLink(
  connectionId: string,
  notePath: string,
  anchor?: string | null,
): string {
  const path = notePath.split("/").map(encodePart).join("/");
  const url =
    SCHEME + connectionId + "/" + path + (anchor ? "#" + encodePart(anchor) : "");
  const check = parseBridgeLink(url);
  if (!check.ok) {
    throw new Error(`Cannot build a Bridge link for "${notePath}" (${check.reason}).`);
  }
  return url;
}

export function parseBridgeLink(input: string): ParseResult {
  const url = input.trim();
  if (!url.toLowerCase().startsWith(SCHEME)) return { ok: false, reason: "not-bridge" };

  const rest = url.slice(SCHEME.length);
  const hash = rest.indexOf("#");
  const main = hash === -1 ? rest : rest.slice(0, hash);
  const rawAnchor = hash === -1 ? "" : rest.slice(hash + 1);

  const slash = main.indexOf("/");
  const id = slash === -1 ? main : main.slice(0, slash);
  if (!ID_PATTERN.test(id)) return { ok: false, reason: "malformed" };

  const rawPath = slash === -1 ? "" : main.slice(slash + 1);
  if (rawPath === "") return { ok: false, reason: "missing-path" };

  const segments: string[] = [];
  for (const raw of rawPath.split("/")) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return { ok: false, reason: "malformed" };
    }
    if (segment === "") return { ok: false, reason: "malformed" };
    if (
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\") ||
      segment.includes("\0")
    ) {
      return { ok: false, reason: "unsafe-path" };
    }
    segments.push(segment);
  }

  let anchor: string | null = null;
  if (rawAnchor !== "") {
    try {
      anchor = decodeURIComponent(rawAnchor);
    } catch {
      return { ok: false, reason: "malformed" };
    }
  }

  return { ok: true, link: { connectionId: id, path: segments.join("/"), anchor } };
}

export function escapeLabel(label: string): string {
  return label.replace(/[\\[\]]/g, "\\$&");
}

/**
 * Finds `[label](bridge://...)` links in text, with an optional "title". Pure string scan.
 * A link must sit on one line and its label is capped, which keeps the scan linear even
 * on pathological notes (thousands of "[" and no "]").
 */
export function findBridgeLinks(
  text: string,
  accept: (url: string) => boolean = isBridgeUrl,
): FoundLink[] {
  const pattern = /\[((?:[^\]\\\n]|\\.){0,500})\]\(\s*((?:bridge|obsidian):\/\/[^)\s]*)(?:\s+"[^"\n]*")?\s*\)/gi;
  const found: FoundLink[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const url = match[2] ?? "";
    if (!accept(url)) continue;
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      label: match[1] ?? "",
      url,
    });
  }
  return found;
}
