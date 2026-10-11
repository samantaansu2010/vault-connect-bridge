import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildBridgeLink,
  escapeLabel,
  findBridgeLinks,
  parseBridgeLink,
} from "../src/core/linkParser.ts";

const ID = "a1b2c3d4";

describe("buildBridgeLink / parseBridgeLink", () => {
  test("produces the documented format", () => {
    assert.equal(
      buildBridgeLink(ID, "Economics/Inflation.md"),
      "bridge://a1b2c3d4/Economics/Inflation.md",
    );
  });

  test("round-trips awkward characters and stays Markdown-safe", () => {
    const paths = [
      "My Notes/Café & Crème (draft) #1.md",
      "100% done/what? yes.md",
      "日本語/ノート.md",
      "it's/a!*.md",
      "a b/c d.md",
    ];
    for (const p of paths) {
      const url = buildBridgeLink(ID, p);
      assert.ok(!/[\s()]/.test(url), `url must not contain spaces or parens: ${url}`);
      const result = parseBridgeLink(url);
      assert.ok(result.ok);
      assert.equal(result.link.path, p);
      assert.equal(result.link.connectionId, ID);
      assert.equal(result.link.anchor, null);
    }
  });

  test("round-trips heading and block anchors", () => {
    for (const anchor of ["Some Heading", "^abc123", "Q&A (2026)"]) {
      const result = parseBridgeLink(buildBridgeLink(ID, "A/B.md", anchor));
      assert.ok(result.ok);
      assert.equal(result.link.anchor, anchor);
      assert.equal(result.link.path, "A/B.md");
    }
  });

  test("rejects invalid and unsafe links with a specific reason", () => {
    const cases: Array<[string, string]> = [
      ["https://example.com/x.md", "not-bridge"],
      ["bridge:/a1b2c3d4/x.md", "not-bridge"],
      ["bridge://A1B2C3D4/x.md", "malformed"],
      ["bridge://a1b2c3/x.md", "malformed"],
      ["bridge://a1b2c3d4", "missing-path"],
      ["bridge://a1b2c3d4/", "missing-path"],
      ["bridge://a1b2c3d4/a//b.md", "malformed"],
      ["bridge://a1b2c3d4/a/", "malformed"],
      ["bridge://a1b2c3d4/%E0%A4%A.md", "malformed"],
      ["bridge://a1b2c3d4/../x.md", "unsafe-path"],
      ["bridge://a1b2c3d4/./x.md", "unsafe-path"],
      ["bridge://a1b2c3d4/%2e%2e/x.md", "unsafe-path"],
      ["bridge://a1b2c3d4/a%2Fb.md", "unsafe-path"],
      ["bridge://a1b2c3d4/a%5Cb.md", "unsafe-path"],
      ["bridge://a1b2c3d4/a%00b.md", "unsafe-path"],
    ];
    for (const [url, reason] of cases) {
      const result = parseBridgeLink(url);
      assert.equal(result.ok, false, url);
      if (!result.ok) assert.equal(result.reason, reason, url);
    }
  });

  test("buildBridgeLink refuses to build unsafe links", () => {
    assert.throws(() => buildBridgeLink(ID, "../secret.md"));
    assert.throws(() => buildBridgeLink("nope", "a.md"));
  });
});

describe("findBridgeLinks", () => {
  test("finds only Bridge links, with positions and raw labels", () => {
    const text =
      "See [Inflation](bridge://a1b2c3d4/Economics/Inflation.md) and [x](https://e.com) " +
      "and [a \\[b\\]](bridge://a1b2c3d4/n.md#H).";
    const found = findBridgeLinks(text);
    assert.equal(found.length, 2);
    assert.equal(found[0]?.label, "Inflation");
    assert.equal(found[0]?.url, "bridge://a1b2c3d4/Economics/Inflation.md");
    assert.equal(text.slice(found[0]!.start, found[0]!.end), "[Inflation](bridge://a1b2c3d4/Economics/Inflation.md)");
    assert.equal(found[1]?.label, "a \\[b\\]");
    assert.equal(found[1]?.url, "bridge://a1b2c3d4/n.md#H");
  });

  test("escaped labels survive build + find", () => {
    const label = "Notes [draft] \\ final";
    const md = `[${escapeLabel(label)}](${buildBridgeLink(ID, "A (1)/B.md")})`;
    const found = findBridgeLinks(md);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.url, "bridge://a1b2c3d4/A%20%281%29/B.md");
  });

  test("returns nothing for text without Bridge links", () => {
    assert.deepEqual(findBridgeLinks("plain [text](https://example.com) [[wikilink]]"), []);
  });
});
