import { isBridgeUrl } from "../ui/readingView.ts";

type OpenFn = (url?: string | URL, target?: string, features?: string) => unknown;

/** Anything with a replaceable `open`, i.e. a Window. */
export interface OpenableWindow {
  open: OpenFn;
}

/**
 * Last-line guard: if anything in the page calls `window.open("bridge://...")`,
 * handle it ourselves instead of letting Electron hand the URL to the OS.
 *
 * Why this exists: a real-Obsidian diagnostic showed the bare bridge:// URL
 * arriving at `window.open` with ZERO Markdown post-processor calls and no anchor
 * involved, i.e. from Obsidian's editor (Live Preview / Source) link handling,
 * which has no <a> for us to rewrite. `window.open` is the single choke point
 * every Obsidian link path (Reading View, Live Preview, Source, popouts, canvas)
 * goes through, and Obsidian looks it up at call time, so a wrapper sees the call.
 *
 * This is a deliberate, isolated monkey-patch (the public API has no hook for
 * custom-scheme links). Safety properties:
 *  - only bridge:// URLs are touched; every other call passes straight through with
 *    its original arguments and `this`;
 *  - uninstall restores the original, and if another plugin wrapped us in the
 *    meantime we cannot unwrap them, so the guard just becomes a pass-through.
 */
export function installBridgeOpenGuard(
  win: OpenableWindow,
  onBridgeUrl: (url: string) => void,
): () => void {
  const original = win.open;
  let active = true;

  const guard: OpenFn = (...args) => {
    const raw = args[0];
    if (active && raw !== undefined && raw !== null && isBridgeUrl(String(raw))) {
      onBridgeUrl(String(raw).trim());
      return null;
    }
    return original.apply(win, args);
  };

  win.open = guard;

  return () => {
    active = false;
    if (win.open === guard) win.open = original;
  };
}
