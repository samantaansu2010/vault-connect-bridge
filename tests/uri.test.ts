import { test } from "node:test";
import assert from "node:assert/strict";
import { buildObsidianOpenUri } from "../src/core/uri.ts";

test("encodes the absolute path as a single query parameter", () => {
  const files = [
    "/home/u/My Vault/Notes & Ideas/Café #1.md",
    "C:\\Vaults\\Research Vault\\Economics\\100% (draft).md",
    "/v/日本語/ノート.md",
  ];
  for (const file of files) {
    const uri = buildObsidianOpenUri(file);
    assert.ok(uri.startsWith("obsidian://open?path="));
    const parsed = new URL(uri);
    assert.equal(parsed.searchParams.get("path"), file);
    assert.deepEqual([...parsed.searchParams.keys()], ["path"]);
  }
});
