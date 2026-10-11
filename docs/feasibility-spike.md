# Feasibility spike: opening notes in another vault

Status: **partly verified in real Obsidian on Windows; the rest is still to do.** The original spike had no
Obsidian app, so everything below started as documentation-only and is marked as it gets confirmed.

## Verified so far (real Obsidian, Windows 11)

- Connecting a vault whose path contains a space (`D:\06_Courses\Git Tutotial`) works.
- Inserting a `bridge://` link works, and the **Open Bridge link under cursor** command opens the target note in the other vault. This confirms `obsidian://open?path=<absolute path>` (checklist items 4 and 10 on Windows).
- Clicking a `bridge://` link in the editor made Obsidian call `window.open("bridge://…")` with the raw URL and **no** Markdown post-processor call and no anchor involved. That is why the plugin guards `window.open` (see `src/platform/externalOpenGuard.ts`).

Not yet confirmed in the real app: that the guard stops the Windows "Get an app to open this 'bridge' link" prompt, Reading View clicks, search, the ribbon buttons and the right-click menu items.

## What the official Obsidian URI docs guarantee

Source: https://help.obsidian.md/uri

- `obsidian://open?vault=<name or id>` opens a vault; adding `file=<name or vault-relative path>` opens a note.
- `obsidian://open?path=<absolute path>` makes Obsidian look for a registered vault that contains that path.
- All values are URL-encoded; the docs show spaces as `%20` and Windows paths with encoded `\` and `:`.

## Decisions that follow

| Question | Decision |
|---|---|
| Which URI form? | `open?path=<absolute path to the note>`. Unambiguous (no vault-name collisions), needs no vault ID and no `obsidian.json`. |
| Paths with spaces / special characters | Whole path goes through `encodeURIComponent` as one parameter. Unit-tested round-trip for spaces, `&`, `#`, `%`, `?`, unicode, Windows separators. |
| Link text safety | `( ) ! ' *` are percent-encoded in `bridge://` links so Markdown never truncates them. |
| Does the target vault need Bridge? | No. Only the Obsidian app and the vault being registered with it. |
| Selecting a vault folder | **Paste the absolute path**, validated by checking the folder contains `.obsidian`. Browse buttons were rejected: `<input webkitdirectory>` makes the browser enumerate the entire folder tree, which breaks the "no unnecessary scanning" rule, and Electron's `File.path` (which older plugins relied on) was removed in recent Electron versions (from memory, not re-verified). Electron's native dialog is not a public Obsidian API. |
| Registered vs unregistered | A plugin cannot ask Obsidian whether a vault is registered. Without `obsidian.json` (deliberately not used) the only signal is Obsidian's own reaction. Settings text tells users to open a vault once first. |
| Open vs closed target vault | Plugin cannot detect this and does not try. It always hands the same URI to Obsidian. |
| Heading/block anchors | Parsed and preserved in links; **not followed** (`FOLLOW_ANCHORS = false` in `src/main.ts`) until verified. The note still opens. |

## Manual verification checklist (do this before the first release)

Run on macOS, Windows and Linux if possible. Also try the search window (include/leave out each vault) and the ribbon and right-click entries. Two vaults, `Research Vault` and `School Vault`, both opened in Obsidian at least once.

1. Click a Bridge link in Reading view while `Research Vault` is **already open** in another window. Expect: that window comes to front with the note open.
2. Close `Research Vault`, click again. Expect: Obsidian opens that vault and the note.
3. Note path containing spaces, `&`, `#`, `%`, parentheses and non-ASCII characters. Expect: opens.
4. Vault folder path containing spaces and non-ASCII characters. Expect: opens. *(Spaces: confirmed on Windows. Non-ASCII: not yet.)*
5. Two registered vaults with the same folder name in different locations. Expect: the right one opens.
6. Folder that exists but was never opened in Obsidian. Record exactly what Obsidian does (error? prompt? nothing?), and update the settings text and README accordingly.
7. Click behavior in Live Preview, Source mode and Reading View. With the `window.open` guard, a plain click should open the note and Windows should never show its "Get an app" prompt. Record each mode; the "Open Bridge link under cursor" command is the fallback.
8. Confirm `bridge://` hrefs survive Reading-view rendering and that Obsidian does not try to open them externally.
9. Try `…#Heading` with `FOLLOW_ANCHORS = true` and record the result before enabling it.
10. Confirm `window.open("obsidian://…")` works on all three platforms; if not, switch to Electron `shell.openExternal` behind the same function. *(Windows: confirmed.)*

11. **Experimental `obsidian://vault-connect-bridge` route.** Open two vaults at once, set Settings → Link format to `obsidian://` in vault A, insert a link, then click it in Live Preview, Reading View and Source. Record: does Obsidian call the registered handler (the troubleshooting report logs `protocol-handler`), does it run in vault A's window (the `vault=` parameter), does the target note open, and is there any flash, extra window or OS prompt?
