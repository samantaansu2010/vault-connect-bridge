import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { installBridgeOpenGuard } from "../src/platform/externalOpenGuard.ts";
import type { OpenableWindow } from "../src/platform/externalOpenGuard.ts";

/** A window whose open() records what would reach Electron / the OS. */
function fakeWindow() {
  const reachedOs: unknown[][] = [];
  const win: OpenableWindow & { thisSeen?: unknown } = {
    open(this: unknown, ...args: unknown[]) {
      win.thisSeen = this;
      reachedOs.push(args);
      return "window-proxy";
    },
  };
  return { win, reachedOs };
}

const URL_ = "bridge://810a9504/Computer%20Science/Python.md";

describe("installBridgeOpenGuard", () => {
  test("intercepts window.open(bridge://...) and never lets it reach the OS", () => {
    const { win, reachedOs } = fakeWindow();
    const handled: string[] = [];
    installBridgeOpenGuard(win, (u) => handled.push(u));
    const result = win.open(URL_);
    assert.equal(result, null);
    assert.deepEqual(handled, [URL_]);
    assert.equal(reachedOs.length, 0);
  });

  test("handles URL objects, other target/feature args, whitespace and case", () => {
    const { win, reachedOs } = fakeWindow();
    const handled: string[] = [];
    installBridgeOpenGuard(win, (u) => handled.push(u));
    win.open(new URL(URL_), "_blank", "noopener");
    win.open("  BRIDGE://810a9504/x.md  ");
    assert.equal(handled.length, 2);
    assert.equal(handled[1], "BRIDGE://810a9504/x.md");
    assert.equal(reachedOs.length, 0);
  });

  test("passes every other URL through untouched, with its original arguments", () => {
    const { win, reachedOs } = fakeWindow();
    const handled: string[] = [];
    installBridgeOpenGuard(win, (u) => handled.push(u));
    const a = win.open("obsidian://open?path=D%3A%5Cvault%5Cnote.md");
    const b = win.open("https://example.com", "_blank", "noopener");
    const c = win.open();
    assert.deepEqual(handled, []);
    assert.equal(a, "window-proxy");
    assert.equal(b, "window-proxy");
    assert.equal(c, "window-proxy");
    assert.deepEqual(reachedOs, [
      ["obsidian://open?path=D%3A%5Cvault%5Cnote.md"],
      ["https://example.com", "_blank", "noopener"],
      [],
    ]);
    assert.equal((win as { thisSeen?: unknown }).thisSeen, win, "original is called with the window as `this`");
  });

  test("uninstall restores the original open()", () => {
    const { win, reachedOs } = fakeWindow();
    const original = win.open;
    const uninstall = installBridgeOpenGuard(win, () => {});
    assert.notEqual(win.open, original);
    uninstall();
    assert.equal(win.open, original);
    win.open(URL_);
    assert.equal(reachedOs.length, 1, "after uninstall bridge:// is no longer ours to handle");
  });

  test("if another plugin wrapped us, uninstall is a safe pass-through (does not clobber them)", () => {
    const { win, reachedOs } = fakeWindow();
    const handled: string[] = [];
    const uninstall = installBridgeOpenGuard(win, (u) => handled.push(u));
    const ours = win.open;
    const theirs: OpenableWindow["open"] = (...args) => ours.apply(win, args);
    win.open = theirs;
    uninstall();
    assert.equal(win.open, theirs, "their wrapper stays installed");
    win.open("https://example.com");
    win.open(URL_);
    assert.equal(handled.length, 0, "guard is inactive after uninstall");
    assert.equal(reachedOs.length, 2);
  });

  test("works independently per window (popout windows)", () => {
    const main = fakeWindow();
    const popout = fakeWindow();
    const handled: string[] = [];
    installBridgeOpenGuard(main.win, (u) => handled.push("main:" + u));
    installBridgeOpenGuard(popout.win, (u) => handled.push("popout:" + u));
    popout.win.open(URL_);
    main.win.open(URL_);
    assert.deepEqual(handled, ["popout:" + URL_, "main:" + URL_]);
    assert.equal(main.reachedOs.length + popout.reachedOs.length, 0);
  });
});
