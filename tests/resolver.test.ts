import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import { BridgeError } from "../src/core/errors.ts";
import { resolveBridgeLink } from "../src/core/resolver.ts";
import type { BridgeConnection } from "../src/core/types.ts";
import { MemFs } from "./helpers/memfs.ts";

const fs = new MemFs({
  files: [
    "/vaults/research/.obsidian/app.json",
    "/vaults/research/Economics/Inflation.md",
    "/vaults/research/Café (draft)/Note #1.md",
  ],
  dirs: ["/vaults/plain-folder", "/vaults/research/Economics/Folder.md"],
});

const connections: BridgeConnection[] = [
  { id: "a1b2c3d4", label: "Research Vault", vaultName: "research", vaultPath: "/vaults/research", status: "ok" },
  { id: "b2c3d4e5", label: "Gone", vaultName: "gone", vaultPath: "/vaults/gone", status: "ok" },
  { id: "c3d4e5f6", label: "Plain", vaultName: "plain-folder", vaultPath: "/vaults/plain-folder", status: "ok" },
];

async function codeOf(url: string): Promise<string> {
  try {
    await resolveBridgeLink(url, connections, fs);
  } catch (e) {
    assert.ok(e instanceof BridgeError, `expected BridgeError, got ${String(e)}`);
    assert.ok(e.message.length > 20, "message should be a real explanation");
    return e.code;
  }
  return "no-error";
}

describe("resolveBridgeLink", () => {
  test("resolves an existing note", async () => {
    const r = await resolveBridgeLink("bridge://a1b2c3d4/Economics/Inflation.md", connections, fs);
    assert.equal(r.absolutePath, path.join("/vaults/research", "Economics", "Inflation.md"));
    assert.equal(r.relativePath, "Economics/Inflation.md");
    assert.equal(r.connection.label, "Research Vault");
  });

  test("resolves encoded special characters", async () => {
    const r = await resolveBridgeLink(
      "bridge://a1b2c3d4/Caf%C3%A9%20%28draft%29/Note%20%231.md",
      connections,
      fs,
    );
    assert.equal(r.absolutePath, path.join("/vaults/research", "Café (draft)", "Note #1.md"));
  });

  test("falls back to .md when the link has no extension", async () => {
    const r = await resolveBridgeLink("bridge://a1b2c3d4/Economics/Inflation", connections, fs);
    assert.equal(r.relativePath, "Economics/Inflation.md");
  });

  test("keeps the anchor for later use", async () => {
    const r = await resolveBridgeLink("bridge://a1b2c3d4/Economics/Inflation.md#Causes", connections, fs);
    assert.equal(r.anchor, "Causes");
  });

  test("reports each failure with its own code", async () => {
    assert.equal(await codeOf("not a link"), "invalid-link");
    assert.equal(await codeOf("bridge://a1b2c3d4"), "invalid-link");
    assert.equal(await codeOf("bridge://a1b2c3d4/../etc/passwd"), "unsafe-path");
    assert.equal(await codeOf("bridge://ffffffff/x.md"), "unknown-connection");
    assert.equal(await codeOf("bridge://b2c3d4e5/x.md"), "vault-missing");
    assert.equal(await codeOf("bridge://c3d4e5f6/x.md"), "not-a-vault");
    assert.equal(await codeOf("bridge://a1b2c3d4/Economics/Deflation.md"), "note-missing");
    assert.equal(await codeOf("bridge://a1b2c3d4/Economics/Folder.md"), "note-missing");
  });
});
