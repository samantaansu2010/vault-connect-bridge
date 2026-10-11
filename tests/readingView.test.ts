import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import { navigateBridgeLink } from "../src/core/navigate.ts";
import type { BridgeConnection } from "../src/core/types.ts";
import {
  BRIDGE_URL_ATTR,
  bridgeUrlFromTarget,
  decorateBridgeAnchors,
  isBridgeUrl,
} from "../src/ui/readingView.ts";
import type { AnchorLike, EventLike, RootLike, SpanLike } from "../src/ui/readingView.ts";
import { MemFs } from "./helpers/memfs.ts";

class FakeSpan implements SpanLike {
  attrs = new Map<string, string>();
  classes = new Set<string>();
  children: unknown[] = [];
  listeners = new Map<string, Array<(e: EventLike) => void>>();
  classList = { add: (...t: string[]) => t.forEach((x) => this.classes.add(x)) };
  get outerHTML() { return `<span ${[...this.attrs].map(([k, v]) => `${k}="${v}"`).join(" ")}>`; }
  setAttribute(n: string, v: string) { this.attrs.set(n, v); }
  getAttribute(n: string) { return this.attrs.get(n) ?? null; }
  append(...nodes: unknown[]) { this.children.push(...nodes); }
  addEventListener(type: string, l: (e: EventLike) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), l]);
  }
  closest() { return this; }
  fire(type: string, key?: string) {
    const event = {
      key,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
    };
    for (const l of this.listeners.get(type) ?? []) l(event);
    return event;
  }
}

/** Stand-in for an <a> as Obsidian renders external links in Reading View. */
class FakeAnchor implements AnchorLike {
  attrs = new Map<string, string>();
  childNodes: unknown[];
  replacedBy: FakeSpan | null = null;
  ownerDocument = { createElement: () => new FakeSpan() };
  constructor(attrs: Record<string, string>, children: unknown[] = ["Inflation"]) {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
    this.childNodes = children;
  }
  get outerHTML() { return `<a ${[...this.attrs].map(([k, v]) => `${k}="${v}"`).join(" ")}>`; }
  getAttribute(n: string) { return this.attrs.get(n) ?? null; }
  replaceWith(...nodes: unknown[]) { this.replacedBy = nodes[0] as FakeSpan; }
  closest() { return this; }
}

/** Mimics querySelectorAll: replaced anchors are no longer in the document. */
function rootOf(...anchors: FakeAnchor[]): RootLike {
  return {
    querySelectorAll: () => anchors.filter((a) => a.replacedBy === null),
  };
}

const URL_ = "bridge://a1b2c3d4/Economics/Inflation.md";
const obsidianAnchor = () =>
  new FakeAnchor({ href: URL_, target: "_blank", rel: "noopener nofollow", class: "external-link" });

describe("decorateBridgeAnchors (anchor -> span replacement)", () => {
  test("replaces the anchor with a span that has nothing the host or OS can act on", () => {
    const a = obsidianAnchor();
    const changed = decorateBridgeAnchors(rootOf(a), {
      open: () => {},
      describe: () => "Research: Economics/Inflation.md",
    });
    assert.equal(changed, 1);
    const span = a.replacedBy;
    assert.ok(span, "anchor must be replaced");
    for (const attr of ["href", "data-href", "target", "rel"]) assert.equal(span.getAttribute(attr), null);
    assert.ok(!span.classes.has("external-link"));
    assert.ok(span.classes.has("bridge-link"));
    assert.equal(span.getAttribute(BRIDGE_URL_ATTR), URL_);
    assert.equal(span.getAttribute("role"), "link");
    assert.equal(span.getAttribute("tabindex"), "0");
    assert.equal(span.getAttribute("aria-label"), "Research: Economics/Inflation.md");
    assert.deepEqual(span.children, ["Inflation"], "link text is carried over");
  });

  test("a click is fully intercepted and opens the original URL once", () => {
    const a = obsidianAnchor();
    const opened: string[] = [];
    decorateBridgeAnchors(rootOf(a), { open: (u) => opened.push(u) });
    const event = a.replacedBy!.fire("click");
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.propagationStopped, true);
    assert.deepEqual(opened, [URL_]);
  });

  test("Enter activates the link; other keys do not", () => {
    const a = obsidianAnchor();
    const opened: string[] = [];
    decorateBridgeAnchors(rootOf(a), { open: (u) => opened.push(u) });
    a.replacedBy!.fire("keydown", "a");
    assert.deepEqual(opened, []);
    const event = a.replacedBy!.fire("keydown", "Enter");
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(opened, [URL_]);
  });

  test("leaves non-bridge links completely alone", () => {
    const web = new FakeAnchor({ href: "https://example.com", target: "_blank", class: "external-link" });
    assert.equal(decorateBridgeAnchors(rootOf(web), { open: () => {} }), 0);
    assert.equal(web.replacedBy, null);
    assert.equal(web.getAttribute("href"), "https://example.com");
  });

  test("is idempotent when Obsidian re-runs post-processors", () => {
    const a = obsidianAnchor();
    const opened: string[] = [];
    const root = rootOf(a);
    assert.equal(decorateBridgeAnchors(root, { open: (u) => opened.push(u) }), 1);
    assert.equal(decorateBridgeAnchors(root, { open: (u) => opened.push(u) }), 0);
    a.replacedBy!.fire("click");
    assert.equal(opened.length, 1);
  });

  test("also handles links exposed only through data-href", () => {
    const a = new FakeAnchor({ "data-href": URL_ });
    const opened: string[] = [];
    decorateBridgeAnchors(rootOf(a), { open: (u) => opened.push(u) });
    a.replacedBy!.fire("click");
    assert.deepEqual(opened, [URL_]);
  });

  test("traces what it saw, including bridge-looking anchors it did NOT match", () => {
    const matched = obsidianAnchor();
    const odd = new FakeAnchor({ href: "app://obsidian.md/bridge:/a1b2c3d4/x.md" });
    const events: string[] = [];
    const root: RootLike = {
      querySelectorAll: (sel) =>
        sel === "a" ? [matched, odd].filter((a) => a.replacedBy === null) : rootOf(matched).querySelectorAll(sel),
    };
    decorateBridgeAnchors(root, { open: () => {}, trace: (e) => events.push(e) });
    assert.ok(events.includes("anchor-before"));
    assert.ok(events.includes("replaced-with"));
    assert.ok(events.includes("decorate"));
    assert.ok(events.includes("unmatched-bridge-like-anchor"));
  });
});

describe("bridgeUrlFromTarget (window-level safety net)", () => {
  test("finds the URL on spans and on stray anchors", () => {
    const span = new FakeSpan();
    span.setAttribute(BRIDGE_URL_ATTR, URL_);
    assert.equal(bridgeUrlFromTarget(span), URL_);
    assert.equal(bridgeUrlFromTarget(new FakeAnchor({ href: URL_ })), URL_);
  });

  test("ignores everything else", () => {
    assert.equal(bridgeUrlFromTarget(new FakeAnchor({ href: "https://example.com" })), null);
    assert.equal(bridgeUrlFromTarget({}), null);
    assert.equal(bridgeUrlFromTarget(null), null);
    assert.equal(bridgeUrlFromTarget({ closest: () => null }), null);
  });

  test("isBridgeUrl is case-insensitive and null-safe", () => {
    assert.equal(isBridgeUrl("BRIDGE://a1b2c3d4/x.md"), true);
    assert.equal(isBridgeUrl("https://x"), false);
    assert.equal(isBridgeUrl(null), false);
  });
});

describe("Reading View click -> resolver -> obsidian:// (no Obsidian)", () => {
  const fs = new MemFs({
    files: ["/vaults/research/.obsidian/app.json", "/vaults/research/Economics/Inflation.md"],
  });
  const connections: BridgeConnection[] = [
    { id: "a1b2c3d4", label: "Research Vault", vaultName: "research", vaultPath: "/vaults/research", status: "ok" },
  ];

  async function click(url: string) {
    const a = new FakeAnchor({ href: url, target: "_blank", class: "external-link" });
    const opened: string[] = [];
    const settled: Promise<unknown>[] = [];
    decorateBridgeAnchors(rootOf(a), {
      open: (u) => {
        settled.push(navigateBridgeLink(u, connections, fs, (uri) => opened.push(uri)).catch((e) => e));
      },
    });
    const event = a.replacedBy!.fire("click");
    const results = await Promise.all(settled);
    return { event, opened, error: results[0] };
  }

  test("opens the resolved note through obsidian://open?path=", async () => {
    const { event, opened } = await click(URL_);
    assert.equal(event.defaultPrevented, true);
    assert.equal(opened.length, 1);
    const uri = new URL(opened[0]!);
    assert.equal(uri.protocol, "obsidian:");
    assert.equal(uri.host, "open");
    assert.equal(uri.searchParams.get("path"), path.join("/vaults/research", "Economics", "Inflation.md"));
  });

  test("a broken link is still intercepted (no OS dialog) and opens nothing", async () => {
    const { event, opened, error } = await click("bridge://a1b2c3d4/Economics/Missing.md");
    assert.equal(event.defaultPrevented, true);
    assert.equal(opened.length, 0);
    assert.ok(error instanceof Error && (error as { code?: string }).code === "note-missing");
  });
});
