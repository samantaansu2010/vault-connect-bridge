import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import { navigateBridgeLink } from "../src/core/navigate.ts";
import {
  PROTOCOL_ACTION,
  buildProtocolLink,
  findLinks,
  parseAnyBridgeLink,
  parseProtocolLink,
  protocolParamsToLink,
  toBridgeUrl,
} from "../src/core/protocol.ts";
import type { BridgeConnection } from "../src/core/types.ts";
import { MemFs } from "./helpers/memfs.ts";

const ID = "a1b2c3d4";

describe("buildProtocolLink / parseProtocolLink", () => {
  test("has the documented shape", () => {
    assert.equal(
      buildProtocolLink("School", ID, "Economics/Inflation.md"),
      "obsidian://vault-connect-bridge?vault=School&id=a1b2c3d4&path=Economics%2FInflation.md",
    );
  });

  test("round-trips awkward vault names and note paths, and stays Markdown-safe", () => {
    const cases: Array<[string, string]> = [
      ["My School (2026)", "My Notes/Café & Crème (draft) #1.md"],
      ["100% vault", "100% done/what? yes.md"],
      ["日本語の庫", "日本語/ノート.md"],
      ["it's", "a!*.md"],
    ];
    for (const [vault, note] of cases) {
      const url = buildProtocolLink(vault, ID, note);
      assert.ok(!/[\s()]/.test(url), `must not contain spaces or parens: ${url}`);
      const parsed = parseProtocolLink(url);
      assert.ok(parsed.ok);
      assert.equal(parsed.link.path, note);
      assert.equal(parsed.link.connectionId, ID);
      assert.equal(new URL(url).searchParams.get("vault"), vault);
    }
  });

  test("carries anchors", () => {
    const parsed = parseProtocolLink(buildProtocolLink("V", ID, "A/B.md", "Some Heading"));
    assert.ok(parsed.ok && parsed.link.anchor === "Some Heading");
  });

  test("refuses to build unsafe links", () => {
    assert.throws(() => buildProtocolLink("V", ID, "../secret.md"));
    assert.throws(() => buildProtocolLink("V", "nope", "a.md"));
  });
});

describe("protocolParamsToLink (what Obsidian's handler receives, already decoded)", () => {
  test("accepts valid params", () => {
    const r = protocolParamsToLink({ id: ID, path: "Economics/Inflation.md" });
    assert.ok(r.ok && r.link.path === "Economics/Inflation.md");
  });

  test("rejects missing, invalid and unsafe params with the same rules as bridge:// links", () => {
    const bad: Array<[Record<string, string | undefined>, string]> = [
      [{}, "malformed"],
      [{ id: ID }, "malformed"],
      [{ path: "a.md" }, "malformed"],
      [{ id: "NOTVALID", path: "a.md" }, "malformed"],
      [{ id: ID, path: "../x.md" }, "unsafe-path"],
      [{ id: ID, path: "a/../../x.md" }, "unsafe-path"],
      [{ id: ID, path: "a\\b.md" }, "unsafe-path"],
      [{ id: ID, path: "a//b.md" }, "malformed"],
      [{ id: ID, path: "/abs.md" }, "malformed"],
    ];
    for (const [params, reason] of bad) {
      const r = protocolParamsToLink(params);
      assert.equal(r.ok, false, JSON.stringify(params));
      if (!r.ok) assert.equal(r.reason, reason, JSON.stringify(params));
    }
  });

  test("a different action or scheme is not ours", () => {
    assert.equal(parseProtocolLink("obsidian://open?vault=V&file=a").ok, false);
    assert.equal(parseProtocolLink("https://example.com/?id=a1b2c3d4&path=a.md").ok, false);
    assert.equal(parseProtocolLink("not a url").ok, false);
  });
});

describe("toBridgeUrl / parseAnyBridgeLink / findLinks", () => {
  test("both formats normalise to the same canonical bridge:// URL", () => {
    const canonical = "bridge://a1b2c3d4/Economics/Inflation.md";
    assert.equal(toBridgeUrl(canonical), canonical);
    assert.equal(toBridgeUrl(buildProtocolLink("School", ID, "Economics/Inflation.md")), canonical);
    assert.equal(toBridgeUrl("obsidian://open?vault=V&file=a"), null);
    assert.equal(toBridgeUrl("junk"), null);
    assert.equal(toBridgeUrl("bridge://a1b2c3d4/../x.md"), null);
  });

  test("parseAnyBridgeLink keeps bridge:// failure reasons", () => {
    const r = parseAnyBridgeLink("bridge://a1b2c3d4/../x.md");
    assert.ok(!r.ok && r.reason === "unsafe-path");
  });

  test("findLinks sees both formats and ignores unrelated obsidian:// links", () => {
    const proto = buildProtocolLink("School", ID, "Notes/B.md");
    const text =
      `[a](bridge://a1b2c3d4/A.md) [b](${proto}) [c](obsidian://open?vault=V&file=x) ` +
      `[d](obsidian://vault-connect-bridge?id=a1b2c3d4) [e](https://x.com)`;
    const found = findLinks(text);
    assert.deepEqual(found.map((f) => f.label), ["a", "b"]);
    assert.equal(text.slice(found[1]!.start, found[1]!.end), `[b](${proto})`);
  });
});

describe("protocol click -> resolver -> obsidian://open (no Obsidian)", () => {
  const fs = new MemFs({
    files: ["/vaults/research/.obsidian/app.json", "/vaults/research/Economics/Inflation.md"],
  });
  const connections: BridgeConnection[] = [
    { id: ID, label: "Research Vault", vaultName: "research", vaultPath: "/vaults/research", status: "ok" },
  ];

  /** What main.ts does when Obsidian calls the registered protocol handler. */
  async function handle(params: Record<string, string>) {
    const parsed = protocolParamsToLink(params);
    const opened: string[] = [];
    if (!parsed.ok) return { opened, invalid: true };
    const bridgeUrl = toBridgeUrl(`bridge://${parsed.link.connectionId}/${parsed.link.path.split("/").map(encodeURIComponent).join("/")}`)!;
    await navigateBridgeLink(bridgeUrl, connections, fs, (u) => opened.push(u));
    return { opened, invalid: false };
  }

  test("a valid handler call opens exactly the resolved note", async () => {
    const { opened } = await handle({ action: PROTOCOL_ACTION, vault: "School", id: ID, path: "Economics/Inflation.md" });
    assert.equal(opened.length, 1);
    assert.equal(new URL(opened[0]!).searchParams.get("path"), path.join("/vaults/research", "Economics", "Inflation.md"));
  });

  test("an invalid handler call opens nothing", async () => {
    const r = await handle({ action: PROTOCOL_ACTION, id: ID, path: "../../etc/passwd" });
    assert.equal(r.invalid, true);
    assert.equal(r.opened.length, 0);
  });
});
