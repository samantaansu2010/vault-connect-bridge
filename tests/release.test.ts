/** Metadata that must stay consistent for Obsidian to load and list the plugin. */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// URLs keep this independent of path separators and drive letters.
const json = (file: string) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const manifest = json("manifest.json");
const pkg = json("package.json");
const versions = json("versions.json");

describe("plugin metadata", () => {
  test("id is valid and package name matches", () => {
    assert.match(manifest.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(!/obsidian/i.test(manifest.id), "plugin ids must not contain 'obsidian'");
    assert.equal(manifest.id, "vault-connect-bridge");
    assert.equal(pkg.name, manifest.id);
    assert.equal(manifest.name, "Vault Connect Bridge");
  });

  test("versions agree and are mapped in versions.json", () => {
    assert.equal(pkg.version, manifest.version);
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.equal(versions[manifest.version], manifest.minAppVersion);
  });

  test("desktop-only is declared (the plugin needs the local filesystem)", () => {
    assert.equal(manifest.isDesktopOnly, true);
  });

  test("the user-facing description makes no cloud claims we can't keep", () => {
    assert.match(manifest.description, /local/i);
    assert.ok(!/cloud|sync|account/i.test(manifest.description.replace(/no network/i, "")));
  });
});
