# Changelog



## 0.0.1
- **Experimental, off by default:** a second link format, `obsidian://vault-connect-bridge?vault=…&id=…&path=…`, handled through Obsidian's own public protocol-handler API instead of intercepting `bridge://`. Choose it in Settings → Quick access → Link format. Links of both formats work everywhere (click, "Open Bridge link under cursor", right-click menu, link counts) and share one parser, resolver and set of safety checks.
- `bridge://` links, the `window.open` guard and every existing behaviour are unchanged.


Bug fixes from a pre-release hunt (each has a regression test):
- Double-clicking **Add** (or two quick "Change location" clicks) could create two connections to the same vault. The duplicate check now runs again after the disk check.
- One unreadable subfolder no longer makes a whole vault "unavailable" in the link picker and search; it is skipped. An unreadable vault root still fails with a clear message.
- Search now finds accented names whichever way they are stored (macOS stores them decomposed). Typing "café" finds it either way.
- Links with a Markdown title, like `[x](bridge://… "title")`, are now recognised by link counts, "Open Bridge link under cursor" and the right-click menu.
- The link scanner stays fast on pathological notes, and a stray `[` can no longer swallow a link on a later line.
- Settings no longer scans your whole vault for link counts when no vaults are connected yet.


- **Search connected vaults:** a search window (command, ribbon button, right-click menu) that finds notes by name and path across your connected vaults and opens the one you pick.
- **On/off per vault, right in the search:** vault switches sit above the results, and the same switches live in Settings → Search. Both change one saved setting.
- Settings → Quick access gains a "Search button" toggle.
- Privacy: only note names and paths are read, only while the window is open, nothing is indexed or stored. Note contents are never read.


- Quick access without the command palette, each optional in Settings → Quick access:
  - ribbon (left sidebar) button to insert a link to a note in another vault;
  - editor right-click menu: "Insert link to a note in another vault" and "Open Bridge link" (when the cursor is on one).
- New setting: text for inserted links (note name, or "Vault name: note name").
- Settings now live beside the connections in `data.json`; existing data keeps working (missing settings fall back to defaults).


- Re-checking connections no longer rewrites `data.json` unless a status actually changed (less disk and sync churn).
- Settings: shorter copy; the link count only appears once known and non-zero.
- Troubleshooting command renamed to "Troubleshoot link clicks".


- Fix: `bridge://` links clicked in Live Preview / Source mode no longer reach the OS ("Get an app to open this 'bridge' link"). A guard on `window.open` routes only `bridge://` URLs to Vault Connect Bridge; all other calls pass through unchanged.


- Reading View: `bridge://` anchors are replaced by clickable spans; open Reading Views are refreshed on load.
- Added the local-only link-click diagnostics command.
- Renamed to Vault Connect Bridge (id `vault-connect-bridge`).

##
- Initial MVP: vault connections, `bridge://` links, cross-vault navigation, Bridge Manager.
