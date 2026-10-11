import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as path from "path";
import { BridgeError } from "../src/core/errors.ts";
import { navigateBridgeLink } from "../src/core/navigate.ts";
import type { BridgeConnection } from "../src/core/types.ts";
import { MemFs } from "./helpers/memfs.ts";

const fs = new MemFs({
  files: ["/vaults/research/.obsidian/app.json", "/vaults/research/My Notes/Café #1.md"],
});
const connections: BridgeConnection[] = [
  { id: "a1b2c3d4", label: "Research Vault", vaultName: "research", vaultPath: "/vaults/research", status: "ok" },
];
const expected = path.join("/vaults/research", "My Notes", "Café #1.md");

describe("navigateBridgeLink", () => {
  test("opens exactly one obsidian://open?path=... URI for a valid link", async () => {
    const opened: string[] = [];
    await navigateBridgeLink(
      "bridge://a1b2c3d4/My%20Notes/Caf%C3%A9%20%231.md",
      connections,
      fs,
      (u) => opened.push(u),
    );
    assert.equal(opened.length, 1);
    assert.equal(new URL(opened[0]!).searchParams.get("path"), expected);
  });

  test("never opens anything when resolution fails", async () => {
    const opened: string[] = [];
    for (const url of ["junk", "bridge://ffffffff/x.md", "bridge://a1b2c3d4/nope.md", "bridge://a1b2c3d4/../x.md"]) {
      await assert.rejects(
        navigateBridgeLink(url, connections, fs, (u) => opened.push(u)),
        (e: unknown) => e instanceof BridgeError,
        url,
      );
    }
    assert.deepEqual(opened, []);
  });

  test("anchors are ignored by default and appended only when enabled", async () => {
    const url = "bridge://a1b2c3d4/My%20Notes/Caf%C3%A9%20%231.md#Heading";
    const off: string[] = [];
    await navigateBridgeLink(url, connections, fs, (u) => off.push(u));
    assert.equal(new URL(off[0]!).searchParams.get("path"), expected);
    const on: string[] = [];
    await navigateBridgeLink(url, connections, fs, (u) => on.push(u), { followAnchors: true });
    assert.equal(new URL(on[0]!).searchParams.get("path"), expected + "#Heading");
  });
});
