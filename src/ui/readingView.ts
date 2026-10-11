/**
 * Reading View support for bridge:// links. No Obsidian imports: only structural
 * DOM-like types, so it is unit-testable and also runs unchanged in a real browser
 * (see scripts/dom-repro.mjs).
 *
 * Mechanism: every bridge:// <a> is REPLACED by a <span role="link">. A span has no
 * href, no target and no default action, and is not an <a>/.external-link, so there
 * is nothing for Obsidian's link handling or Electron's protocol hand-off to act
 * on, no matter which event or phase the host uses. (The previous approach kept the
 * anchor and only stripped attributes; a host that re-adds them, or acts on the
 * anchor before us, would still reach the OS "Get an app to open this link" dialog.)
 */

export const BRIDGE_URL_ATTR = "data-bridge-url";

export interface EventLike {
  key?: string;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface SpanLike {
  outerHTML?: string;
  setAttribute(name: string, value: string): void;
  classList: { add(...tokens: string[]): void };
  addEventListener(type: string, listener: (event: EventLike) => void): void;
  append(...nodes: unknown[]): void;
}

export interface AnchorLike {
  outerHTML?: string;
  getAttribute(name: string): string | null;
  childNodes: ArrayLike<unknown>;
  ownerDocument: { createElement(tagName: string): SpanLike } | null;
  replaceWith(...nodes: unknown[]): void;
}

export interface RootLike {
  querySelectorAll(selectors: string): ArrayLike<AnchorLike>;
}

export interface DecorateOptions {
  /** Called with the original bridge:// URL when the user activates the link. */
  open: (url: string) => void;
  /** Optional hover text for a link. */
  describe?: (url: string) => string | null;
  /** Optional diagnostics sink. */
  trace?: (event: string, detail: string) => void;
}

export function isBridgeUrl(value: string | null | undefined): value is string {
  return !!value && value.trim().toLowerCase().startsWith("bridge://");
}

/** Replaces every bridge:// anchor under `root` with a self-handling span. Returns how many. */
export function decorateBridgeAnchors(root: RootLike, options: DecorateOptions): number {
  const { trace } = options;
  const matched = root.querySelectorAll('a[href^="bridge://" i], a[data-href^="bridge://" i]');
  // Snapshot first: replacing nodes while walking a live list would skip items.
  const anchors: AnchorLike[] = [];
  for (let i = 0; i < matched.length; i++) {
    const anchor = matched[i];
    if (anchor) anchors.push(anchor);
  }

  let changed = 0;
  for (const anchor of anchors) {
    const url = anchor.getAttribute("href") ?? anchor.getAttribute("data-href");
    const doc = anchor.ownerDocument;
    if (!isBridgeUrl(url) || !doc) continue;

    trace?.("anchor-before", anchor.outerHTML ?? "(no outerHTML)");

    const span = doc.createElement("span");
    span.append(...Array.from(anchor.childNodes));
    span.setAttribute(BRIDGE_URL_ATTR, url);
    span.setAttribute("role", "link");
    span.setAttribute("tabindex", "0");
    span.classList.add("bridge-link");
    const hover = options.describe?.(url);
    if (hover) span.setAttribute("aria-label", hover);

    span.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      options.open(url);
    });
    span.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      options.open(url);
    });

    anchor.replaceWith(span);
    trace?.("replaced-with", span.outerHTML ?? "(no outerHTML)");
    changed++;
  }

  if (trace) {
    // Evidence for "Obsidian rendered the link differently than expected".
    const all = root.querySelectorAll("a");
    for (let i = 0; i < all.length; i++) {
      const html = all[i]?.outerHTML ?? "";
      if (/bridge/i.test(html)) trace("unmatched-bridge-like-anchor", html);
    }
    if (matched.length > 0) trace("decorate", `matched=${matched.length} replaced=${changed}`);
  }
  return changed;
}

/** For the window-level safety net: finds a bridge URL on or above a click target. */
export function bridgeUrlFromTarget(target: unknown): string | null {
  const el = target as {
    closest?: (selector: string) => { getAttribute(name: string): string | null } | null;
  } | null;
  const node = el && typeof el.closest === "function" ? el.closest("[data-bridge-url], a") : null;
  if (!node) return null;
  for (const attr of [BRIDGE_URL_ATTR, "href", "data-href"]) {
    const value = node.getAttribute(attr);
    if (isBridgeUrl(value)) return value;
  }
  return null;
}
