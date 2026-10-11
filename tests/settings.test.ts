import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, defaultLinkLabel, normalizeSettings } from "../src/core/settings.ts";

describe("normalizeSettings", () => {
  test("returns the defaults for missing or garbage data", () => {
    for (const raw of [undefined, null, 42, "x", [], {}, { settings: null }, { settings: "no" }, { settings: [] }]) {
      assert.deepEqual(normalizeSettings(raw), DEFAULT_SETTINGS);
    }
  });

  test("keeps valid values and replaces invalid ones field by field", () => {
    const s = normalizeSettings({
      settings: { showRibbonButton: false, showEditorMenu: "yes", linkLabelStyle: "vault-and-note" },
    });
    assert.deepEqual(s, { showRibbonButton: false, showSearchButton: true, showEditorMenu: true, linkLabelStyle: "vault-and-note", linkFormat: "bridge" });
    assert.equal(normalizeSettings({ settings: { linkFormat: "protocol" } }).linkFormat, "protocol");
    assert.equal(normalizeSettings({ settings: { linkFormat: "weird" } }).linkFormat, "bridge");
    assert.equal(normalizeSettings({ settings: { linkLabelStyle: "weird" } }).linkLabelStyle, "note");
  });

  test("settings sitting next to connections do not disturb either", () => {
    const raw = { schemaVersion: 1, connections: [], settings: { showEditorMenu: false } };
    assert.equal(normalizeSettings(raw).showEditorMenu, false);
    assert.equal(normalizeSettings(raw).showRibbonButton, true);
  });

  test("defaults are quick-access friendly", () => {
    assert.equal(DEFAULT_SETTINGS.showRibbonButton, true);
    assert.equal(DEFAULT_SETTINGS.showEditorMenu, true);
  });
});

describe("defaultLinkLabel", () => {
  test("note style uses the file name without .md", () => {
    assert.equal(defaultLinkLabel("note", "Economics/Inflation.md", "Research Vault"), "Inflation");
    assert.equal(defaultLinkLabel("note", "Plain.MD", "R"), "Plain");
    assert.equal(defaultLinkLabel("note", "a/b/Report.v2.md", "R"), "Report.v2");
  });

  test("vault-and-note style prefixes the connection label", () => {
    assert.equal(defaultLinkLabel("vault-and-note", "Economics/Inflation.md", "Research Vault"), "Research Vault: Inflation");
  });
});

import { ConnectionRegistry } from "../src/core/registry.ts";
import { MemFs } from "./helpers/memfs.ts";

describe("data.json holds connections and settings together", () => {
  test("a registry save merged with settings round-trips both", async () => {
    const fs = new MemFs({ files: ["/vaults/a/.obsidian/app.json"] });
    const settings = { showRibbonButton: false, showSearchButton: false, showEditorMenu: true, linkLabelStyle: "vault-and-note" as const, linkFormat: "protocol" as const };
    let disk: unknown = undefined;
    // This is exactly the merge main.ts performs in its `save` callback.
    const save = async (data: object) => { disk = { ...data, settings }; };

    const registry = new ConnectionRegistry(undefined, { currentVaultPath: null, fs, save });
    const { id } = await registry.add("/vaults/a");
    await registry.rename(id, "Research Vault");
    await registry.testAll(); // unchanged status: must not write

    const reloaded = new ConnectionRegistry(JSON.parse(JSON.stringify(disk)), { currentVaultPath: null, fs, save });
    assert.equal(reloaded.list()[0]?.label, "Research Vault");
    assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(disk))), settings);
  });
});
