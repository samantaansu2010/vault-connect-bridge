import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import { BridgeError } from "../src/core/errors.ts";
import { ConnectionRegistry, normalizeData, normalizeVaultPath } from "../src/core/registry.ts";
import type { BridgeData } from "../src/core/types.ts";
import { MemFs } from "./helpers/memfs.ts";

function setup(raw: unknown = undefined, extra: { files?: string[]; dirs?: string[] } = {}) {
  const fs = new MemFs({
    files: [
      "/vaults/research/.obsidian/app.json",
      "/vaults/school/.obsidian/app.json",
      "/vaults/moved/.obsidian/app.json",
      "/me/current/.obsidian/app.json",
      ...(extra.files ?? []),
    ],
    dirs: ["/vaults/not-a-vault", ...(extra.dirs ?? [])],
  });
  const saves: BridgeData[] = [];
  let counter = 0;
  const registry = new ConnectionRegistry(raw, {
    currentVaultPath: "/me/current",
    fs,
    save: async (d) => {
      saves.push(structuredClone(d));
    },
    randomBytes: () => new Uint8Array([0, 0, 0, ++counter]),
    now: () => 1_000,
  });
  return { registry, saves, fs };
}

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (e: unknown) => e instanceof BridgeError && e.code === code);
}

describe("add", () => {
  test("connects a vault, storing name, path, id and status", async () => {
    const { registry, saves } = setup();
    const c = await registry.add("/vaults/research");
    assert.equal(c.id, "00000001");
    assert.equal(c.label, "research");
    assert.equal(c.vaultName, "research");
    assert.equal(c.vaultPath, path.resolve("/vaults/research"));
    assert.equal(c.status, "ok");
    assert.equal(saves.length, 1);
    assert.equal(saves[0]?.connections.length, 1);
  });

  test("tolerates quotes, whitespace and trailing slashes", async () => {
    const { registry } = setup();
    const c = await registry.add('  "/vaults/school/"  ');
    assert.equal(c.vaultPath, path.resolve("/vaults/school"));
  });

  test("rejects bad input with clear codes and saves nothing", async () => {
    const { registry, saves } = setup();
    await rejectsWith(registry.add(""), "invalid-path");
    await rejectsWith(registry.add("relative/path"), "invalid-path");
    await rejectsWith(registry.add("/vaults/nope"), "vault-missing");
    await rejectsWith(registry.add("/vaults/not-a-vault"), "not-a-vault");
    await rejectsWith(registry.add("/me/current"), "current-vault");
    assert.equal(saves.length, 0);
    assert.equal(registry.list().length, 0);
  });

  test("rejects duplicates", async () => {
    const { registry } = setup();
    await registry.add("/vaults/research");
    await rejectsWith(registry.add("/vaults/research/"), "duplicate");
  });

  test("never reuses an id", async () => {
    const { registry } = setup();
    const a = await registry.add("/vaults/research");
    const b = await registry.add("/vaults/school");
    assert.notEqual(a.id, b.id);
  });
});

describe("rename / remove / relocate / test", () => {
  test("rename changes only the label", async () => {
    const { registry } = setup();
    const { id } = await registry.add("/vaults/research");
    await registry.rename(id, "  Research Vault  ");
    const c = registry.get(id);
    assert.equal(c?.label, "Research Vault");
    assert.equal(c?.vaultPath, path.resolve("/vaults/research"));
    assert.equal(c?.id, id);
    await rejectsWith(registry.rename(id, "   "), "invalid-label");
    await rejectsWith(registry.rename(id, "x".repeat(101)), "invalid-label");
  });

  test("remove drops the connection and fails clearly for unknown ids", async () => {
    const { registry } = setup();
    const { id } = await registry.add("/vaults/research");
    await registry.remove(id);
    assert.equal(registry.list().length, 0);
    await rejectsWith(registry.remove(id), "unknown-connection");
  });

  test("relocate keeps the id so existing links still work", async () => {
    const { registry } = setup();
    const { id } = await registry.add("/vaults/research");
    const moved = await registry.relocate(id, "/vaults/moved");
    assert.equal(moved.id, id);
    assert.equal(moved.vaultPath, path.resolve("/vaults/moved"));
    await rejectsWith(registry.relocate(id, "/vaults/nope"), "vault-missing");
  });

  test("relocate refuses a folder used by another connection", async () => {
    const { registry } = setup();
    const a = await registry.add("/vaults/research");
    await registry.add("/vaults/school");
    await rejectsWith(registry.relocate(a.id, "/vaults/school"), "duplicate");
  });

  test("test reports not-found and not-a-vault without throwing", async () => {
    const stored = {
      schemaVersion: 1,
      connections: [
        { id: "aaaaaaaa", label: "A", vaultName: "a", vaultPath: "/vaults/research", status: "unknown" },
        { id: "bbbbbbbb", label: "B", vaultName: "b", vaultPath: "/vaults/gone", status: "ok" },
        { id: "cccccccc", label: "C", vaultName: "c", vaultPath: "/vaults/not-a-vault", status: "ok" },
      ],
    };
    const { registry } = setup(stored);
    assert.equal(await registry.test("aaaaaaaa"), "ok");
    assert.equal(await registry.test("bbbbbbbb"), "not-found");
    assert.equal(await registry.test("cccccccc"), "not-a-vault");
    await registry.testAll();
    assert.deepEqual(registry.list().map((c) => c.status), ["ok", "not-found", "not-a-vault"]);
  });
});

describe("normalizeData / normalizeVaultPath", () => {
  test("survives garbage and drops invalid or duplicate entries", () => {
    for (const raw of [undefined, null, 42, "x", [], {}, { connections: "no" }]) {
      assert.deepEqual(normalizeData(raw), { schemaVersion: 1, connections: [] });
    }
    const data = normalizeData({
      connections: [
        null,
        { id: "NOTVALID", vaultPath: "/a" },
        { id: "aaaaaaaa", vaultPath: "" },
        { id: "aaaaaaaa", vaultPath: "/vaults/research", label: "  ", status: "weird" },
        { id: "aaaaaaaa", vaultPath: "/dup" },
      ],
    });
    assert.equal(data.connections.length, 1);
    assert.equal(data.connections[0]?.label, "research");
    assert.equal(data.connections[0]?.status, "unknown");
  });

  test("normalizeVaultPath resolves dots and strips quotes", () => {
    assert.equal(normalizeVaultPath("'/a/b/../c/'"), path.resolve("/a/c"));
  });
});

describe("data.json writes", () => {
  test("re-checking unchanged connections never rewrites data.json", async () => {
    const { registry, saves } = setup();
    const { id } = await registry.add("/vaults/research");
    saves.length = 0;
    await registry.testAll();
    await registry.testAll();
    assert.equal(await registry.test(id), "ok");
    assert.equal(saves.length, 0);
  });

  test("a status change is saved exactly once, then stays quiet", async () => {
    const stored = {
      schemaVersion: 1,
      connections: [{ id: "aaaaaaaa", label: "A", vaultName: "a", vaultPath: "/vaults/gone", status: "ok" }],
    };
    const { registry, saves } = setup(stored);
    await registry.testAll(); // ok -> not-found
    assert.equal(saves.length, 1);
    assert.equal(saves[0]?.connections[0]?.status, "not-found");
    await registry.testAll();
    await registry.test("aaaaaaaa");
    assert.equal(saves.length, 1);
  });
});
