/** Regression tests for edge cases found in the pre-release bug hunt. */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BridgeError } from "../src/core/errors.ts";
import type { DirEntry, FsPort } from "../src/core/fsPort.ts";
import { findBridgeLinks } from "../src/core/linkParser.ts";
import { listNotes } from "../src/core/notes.ts";
import { ConnectionRegistry } from "../src/core/registry.ts";
import { searchNotes, toSearchItem } from "../src/core/search.ts";
import { MemFs } from "./helpers/memfs.ts";

describe("double-clicking Add (concurrent add of the same vault)", () => {
  test("only one connection is created; the second attempt is rejected as a duplicate", async () => {
    const fs = new MemFs({ files: ["/vaults/a/.obsidian/app.json"] });
    const registry = new ConnectionRegistry(undefined, { currentVaultPath: null, fs, save: async () => {} });
    const results = await Promise.allSettled([registry.add("/vaults/a"), registry.add("/vaults/a")]);
    assert.equal(registry.list().length, 1);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.ok(rejected.reason instanceof BridgeError && rejected.reason.code === "duplicate");
  });

  test("two connections cannot be relocated onto the same folder at once", async () => {
    const fs = new MemFs({
      files: ["/v/a/.obsidian/x", "/v/b/.obsidian/x", "/v/target/.obsidian/x"],
    });
    const registry = new ConnectionRegistry(undefined, { currentVaultPath: null, fs, save: async () => {} });
    const a = await registry.add("/v/a");
    const b = await registry.add("/v/b");
    await Promise.allSettled([registry.relocate(a.id, "/v/target"), registry.relocate(b.id, "/v/target")]);
    const paths = registry.list().map((c) => c.vaultPath);
    assert.equal(new Set(paths).size, 2, "no two connections may share a folder");
  });
});

describe("listNotes survives an unreadable subfolder", () => {
  test("skips it and still lists everything else", async () => {
    const inner = new MemFs({ files: ["/v/ok/a.md", "/v/locked/secret.md", "/v/b.md"] });
    const fs: FsPort = {
      isDirectory: (p) => inner.isDirectory(p),
      isFile: (p) => inner.isFile(p),
      readdir: async (p): Promise<DirEntry[]> => {
        if (/locked$/.test(p)) throw new Error("EACCES");
        return inner.readdir(p);
      },
    };
    const { notes } = await listNotes(fs, "/v");
    assert.deepEqual(notes, ["b.md", "ok/a.md"]);
  });

  test("an unreadable ROOT still fails loudly", async () => {
    const fs: FsPort = {
      isDirectory: async () => true,
      isFile: async () => false,
      readdir: async () => { throw new Error("EACCES"); },
    };
    await assert.rejects(listNotes(fs, "/v"));
  });
});

describe("search ignores Unicode normalization differences (macOS stores accents decomposed)", () => {
  test("a typed é finds a decomposed filename, and the reverse", () => {
    const decomposed = toSearchItem("a1b2c3d4", "V", "Caf\u0065\u0301 notes.md"); // e + combining acute
    const composed = toSearchItem("a1b2c3d4", "V", "Caf\u00e9 notes.md");
    assert.equal(searchNotes([decomposed], "caf\u00e9").length, 1);
    assert.equal(searchNotes([composed], "caf\u0065\u0301").length, 1);
  });
});

describe("findBridgeLinks", () => {
  test("accepts an optional Markdown link title", () => {
    const text = '[x](bridge://a1b2c3d4/Notes/a.md "A title") and [y](bridge://a1b2c3d4/b.md)';
    const found = findBridgeLinks(text);
    assert.deepEqual(found.map((f) => f.url), ["bridge://a1b2c3d4/Notes/a.md", "bridge://a1b2c3d4/b.md"]);
    assert.equal(text.slice(found[0]!.start, found[0]!.end), '[x](bridge://a1b2c3d4/Notes/a.md "A title")');
  });

  test("stays fast on pathological input (many '[' and no ']')", () => {
    const evil = "[".repeat(60_000) + " bridge://a1b2c3d4/x.md";
    const start = Date.now();
    assert.deepEqual(findBridgeLinks(evil), []);
    assert.ok(Date.now() - start < 500, `took ${Date.now() - start}ms`);
  });

  test("does not join a '[' on one line with a link on a later line", () => {
    const found = findBridgeLinks("a [ stray bracket\nand [real](bridge://a1b2c3d4/x.md)");
    assert.equal(found.length, 1);
    assert.equal(found[0]!.label, "real");
  });
});
