import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { listNotes } from "../src/core/notes.ts";
import { MemFs } from "./helpers/memfs.ts";

const fs = new MemFs({
  files: [
    "/v/.obsidian/hidden.md",
    "/v/.git/c.md",
    "/v/Z.md",
    "/v/UP.MD",
    "/v/a/b.md",
    "/v/a/readme.txt",
    "/v/a/deep/er/c.md",
    "/v/.trash/gone.md",
  ],
  symlinks: ["/v/linked"],
});

describe("listNotes", () => {
  test("lists only visible Markdown notes, sorted, without following symlinks", async () => {
    const { notes, truncated } = await listNotes(fs, "/v");
    assert.deepEqual(notes, ["UP.MD", "Z.md", "a/b.md", "a/deep/er/c.md"]);
    assert.equal(truncated, false);
  });

  test("stops at the cap and reports truncation", async () => {
    const { notes, truncated } = await listNotes(fs, "/v", { max: 2 });
    assert.equal(notes.length, 2);
    assert.equal(truncated, true);
  });
});
