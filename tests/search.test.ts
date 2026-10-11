import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import { ConnectionRegistry, normalizeData } from "../src/core/registry.ts";
import { isSearchEnabled, loadSearchableVault, searchNotes, toSearchItem } from "../src/core/search.ts";
import type { BridgeConnection } from "../src/core/types.ts";
import { MemFs } from "./helpers/memfs.ts";

const item = (p: string, vault = "Research") => toSearchItem("a1b2c3d4", vault, p);
const paths = (items: { path: string }[]) => items.map((i) => i.path);

describe("searchNotes", () => {
  const items = [
    "Economics/Inflation.md",
    "Economics/Deflation.md",
    "Notes/Inflation rate history.md",
    "Archive/old/2019/economics-inflation-draft.md",
    "Python.md",
    "Computer Science/Python Basics.md",
  ].map((p) => item(p));

  test("ranks exact name, then prefix, then substring, then path, then fuzzy", () => {
    const r = paths(searchNotes(items, "inflation"));
    assert.deepEqual(r, [
      "Economics/Inflation.md", // exact name
      "Notes/Inflation rate history.md", // name starts with
      "Archive/old/2019/economics-inflation-draft.md", // name contains
    ]);
    assert.ok(paths(searchNotes(items, "flation")).includes("Economics/Deflation.md"));
  });

  test("every word must match, in any order, case-insensitively", () => {
    assert.deepEqual(paths(searchNotes(items, "BASICS python")), ["Computer Science/Python Basics.md"]);
    assert.deepEqual(paths(searchNotes(items, "economics inflation")).slice(0, 2), [
      "Economics/Inflation.md",
      "Archive/old/2019/economics-inflation-draft.md",
    ]);
  });

  test("matches words that only appear in the folder path", () => {
    assert.deepEqual(paths(searchNotes(items, "computer science")), ["Computer Science/Python Basics.md"]);
  });

  test("falls back to fuzzy (in-order letters) matching", () => {
    // i-n-f ... r ... t in order: both inflation notes qualify, shorter path first; the rest do not.
    assert.deepEqual(paths(searchNotes(items, "infrt")), [
      "Notes/Inflation rate history.md",
      "Archive/old/2019/economics-inflation-draft.md",
    ]);
  });

  test("returns nothing when no word matches", () => {
    assert.deepEqual(searchNotes(items, "zzzz"), []);
    assert.deepEqual(searchNotes(items, "inflation zzzz"), []);
  });

  test("empty or whitespace query lists the first items; limit is honoured", () => {
    assert.equal(searchNotes(items, "   ").length, items.length);
    assert.equal(searchNotes(items, "", 2).length, 2);
    assert.equal(searchNotes(items, "e", 3).length, 3);
  });

  test("shorter paths win ties, results are deterministic", () => {
    const tie = [item("deep/er/Note.md"), item("Note.md"), item("a/Note.md")];
    assert.deepEqual(paths(searchNotes(tie, "note")), ["Note.md", "a/Note.md", "deep/er/Note.md"]);
  });

  test("keeps which vault each result came from", () => {
    const mixed = [toSearchItem("aaaaaaaa", "School", "Python.md"), toSearchItem("bbbbbbbb", "Research", "Python.md")];
    const r = searchNotes(mixed, "python");
    assert.deepEqual(r.map((i) => i.vaultLabel), ["School", "Research"]);
  });

  test("handles a very large list quickly", () => {
    const big = Array.from({ length: 100_000 }, (_, i) => item(`folder${i % 50}/note-${i}.md`));
    const start = Date.now();
    const r = searchNotes(big, "note 99999");
    assert.equal(r[0]?.path, "folder49/note-99999.md");
    assert.ok(Date.now() - start < 2000, "a keystroke over 100k notes must stay responsive");
  });
});

describe("toSearchItem", () => {
  test("derives the display name without .md", () => {
    assert.equal(item("a/b/Report.v2.md").name, "Report.v2");
    assert.equal(item("UP.MD").name, "UP");
    assert.equal(item("Café #1.md").lowerName, "café #1");
  });
});

describe("loadSearchableVault", () => {
  const fs = new MemFs({
    files: [
      "/vaults/research/.obsidian/app.json",
      "/vaults/research/Economics/Inflation.md",
      "/vaults/research/readme.txt",
      "/vaults/research/.trash/gone.md",
    ],
    dirs: ["/vaults/plain"],
  });
  const conn = (id: string, label: string, vaultPath: string): BridgeConnection => ({
    id, label, vaultName: label, vaultPath, status: "ok",
  });

  test("lists notes tagged with the connection, skipping hidden folders and non-notes", async () => {
    const r = await loadSearchableVault(fs, conn("a1b2c3d4", "Research Vault", "/vaults/research"));
    assert.ok(r.ok);
    assert.deepEqual(paths(r.items), ["Economics/Inflation.md"]);
    assert.equal(r.items[0]?.vaultLabel, "Research Vault");
    assert.equal(r.items[0]?.connectionId, "a1b2c3d4");
  });

  test("reports unreachable vaults and non-vault folders instead of throwing", async () => {
    const gone = await loadSearchableVault(fs, conn("b2c3d4e5", "Gone", "/vaults/gone"));
    assert.ok(!gone.ok && /Gone/.test(gone.reason));
    const plain = await loadSearchableVault(fs, conn("c3d4e5f6", "Plain", "/vaults/plain"));
    assert.ok(!plain.ok && /\.obsidian/.test(plain.reason));
  });

  test("a read failure becomes a reason, not an exception", async () => {
    const broken = {
      isDirectory: async () => true,
      isFile: async () => false,
      readdir: async () => { throw new Error("EACCES"); },
    };
    const r = await loadSearchableVault(broken, conn("a1b2c3d4", "Locked", "/x"));
    assert.ok(!r.ok && /Locked/.test(r.reason));
  });
});

describe("per-vault search switch", () => {
  test("missing means on; only an explicit false turns it off", () => {
    assert.equal(isSearchEnabled({}), true);
    assert.equal(isSearchEnabled({ includeInSearch: true }), true);
    assert.equal(isSearchEnabled({ includeInSearch: false }), false);
  });

  test("normalizeData keeps booleans and ignores junk", () => {
    const data = normalizeData({
      connections: [
        { id: "aaaaaaaa", vaultPath: "/a", includeInSearch: false },
        { id: "bbbbbbbb", vaultPath: "/b", includeInSearch: "no" },
        { id: "cccccccc", vaultPath: "/c" },
      ],
    });
    assert.deepEqual(data.connections.map((c) => c.includeInSearch), [false, undefined, undefined]);
  });

  test("setIncludeInSearch persists changes only, and survives a reload", async () => {
    const fs = new MemFs({ files: [path.resolve("/vaults/a/.obsidian/app.json")] });
    let disk: unknown;
    let writes = 0;
    const save = async (d: object) => { disk = JSON.parse(JSON.stringify(d)); writes++; };
    const registry = new ConnectionRegistry(undefined, { currentVaultPath: null, fs, save });
    const { id } = await registry.add("/vaults/a");
    writes = 0;

    await registry.setIncludeInSearch(id, true); // already on: no write
    assert.equal(writes, 0);
    await registry.setIncludeInSearch(id, false);
    assert.equal(writes, 1);
    await registry.setIncludeInSearch(id, false); // unchanged
    assert.equal(writes, 1);

    const reloaded = new ConnectionRegistry(disk, { currentVaultPath: null, fs, save });
    assert.equal(isSearchEnabled(reloaded.list()[0]!), false);
    await reloaded.setIncludeInSearch(id, true);
    assert.equal(isSearchEnabled(reloaded.list()[0]!), true);
  });
});
