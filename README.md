# Vault Connect Bridge

An Obsidian plugin that lets you link between separate vaults without merging them.

If you keep more than one vault, you've probably wished you could point from a note in one to a note in another and just click it. That's what this does. Your vaults stay completely separate. Nothing is copied, synced or uploaded. A link simply remembers which vault and which note you meant, and opens it when you click.

It's free, open source (MIT), works offline, and has no account, server or tracking.

> **Early version.** It works, but some parts are new and still being tested in real Obsidian, especially clicking links in Live Preview and the search window. If something doesn't behave, please open an issue.

## What you can do

- Connect other vaults on your computer.
- Insert a link to any note in a connected vault, and click it to open that note in its own vault.
- Search note names across your connected vaults, and switch individual vaults on or off right in the search.
- Use buttons and right-click menus instead of the command palette, if that's your style.

## What you need

- Obsidian **1.7.2 or newer**, on **desktop** (Windows, macOS or Linux). It needs to look at folders on your computer, so it can't run on mobile.
- The other vault must already be in Obsidian's vault switcher. Open it in Obsidian at least once.

## Install

It isn't in the community plugin list yet, so for now you install it by hand:

1. Download `main.js`, `manifest.json` and `styles.css` from the latest release.
2. Put them in a folder called `vault-connect-bridge` inside your vault's plugin folder: `<your vault>/.obsidian/plugins/vault-connect-bridge/`
3. In Obsidian, go to Settings → Community plugins, turn on community plugins if you haven't, and enable **Vault Connect Bridge**.

The other vault doesn't need the plugin installed. Only the vault you're linking *from* does.

## Getting started

**1. Connect a vault.** Go to Settings → Vault Connect Bridge. Under "Add a vault", paste the full path to the vault's folder (the folder that contains `.obsidian`), for example `D:\Notes\Research` or `/Users/me/Research`. Click Add.

**2. Insert a link.** While editing a note, click the link button in the left sidebar, or use the right-click menu, or run the command **Insert link to a note in another vault**. Pick the vault, then the note. A link appears in your note.

**3. Click it.** The note opens in the other vault.

You can rename a connection, check that it still works, point it at a new folder, or remove it from the same settings page. Removing a connection never touches any files; it just means links to that vault stop opening until you connect it again.

## What the links look like

A Bridge link is a normal Markdown link:

```
[Inflation](bridge://a1b2c3d4/Economics/Inflation.md)
```

The short code (`a1b2c3d4`) identifies the connection on your computer, and the rest is the path to the note inside that vault. Because links use the code and not the name, renaming a connection won't break anything. If you ever need to move a vault to a new folder, use "Change location" instead of removing it, and your links keep working.

If you remove the plugin, these just become ordinary links that don't do anything.

## Search connected vaults

Open it from the search button in the sidebar, the command **Search connected vaults**, or the right-click menu. Type part of a note's name or folder. Every word has to match, in any order, and letters in the right order match loosely too. Choose a result and it opens in its own vault.

Above the results there's a button for each vault. Click one to leave that vault out of the search, click again to bring it back. The same choice is in Settings under Search.

A few honest notes:

- Obsidian doesn't allow plugins to add results to its built-in search panel, so this is a separate window.
- It searches note **names and folders only**. It never reads what's inside your notes.
- It only looks at a vault while the search window is open, and it doesn't keep anything afterwards.

## Settings

Under Settings → Vault Connect Bridge → Quick access, you can turn these on or off:

- **Ribbon button** to insert a link.
- **Search button** in the sidebar.
- **Right-click menu** entries (Search, Insert link, and Open Bridge link when your cursor is on one).
- **New link text:** whether new links are named after the note, or "Vault name: note name".

## Privacy

Everything stays on your computer. The plugin makes no network requests, collects nothing, and has no account.

Other vaults are strictly read-only. The plugin checks that folders and notes exist, and lists note names when you use the link picker or search. It never changes, creates or deletes anything in them. Your connections and settings are saved in the plugin's own `data.json`.

## Experimental: obsidian:// links

Obsidian has no official way for a plugin to handle its own kind of link, so `bridge://` links work by watching for them at the last moment before they would leave Obsidian. That works, but it's a workaround.

There's a second option that uses a route Obsidian *does* officially support. In Settings → Quick access, set **Link format (experimental)** to `obsidian://`. New links then look like this:

```
[Inflation](obsidian://vault-connect-bridge?vault=School&id=a1b2c3d4&path=Economics%2FInflation.md)
```

Clicking one hands the link to Obsidian, which passes it back to this plugin, and from there it takes exactly the same path as any other link: same checks, same result. Links you already made keep working, in either format.

Two catches. These links contain the name of the vault they were made in (`vault=School`), so they only work when clicked from that vault. And I haven't yet confirmed how well this behaves when several vaults are open, which is why it's off by default. If you try it, I'd like to hear how it goes.

## Things to know

- **Connections are per computer.** They store folder paths, so on another machine a connection shows as unavailable until you use "Change location".
- **Moved or renamed notes aren't followed.** If a note moved, the link shows a clear "not found" message and you'll need to update the link yourself.
- **Headings and blocks:** a link can store a heading or block, but for now Obsidian opens the note from the top.
- **Open or closed:** the plugin can't tell whether the other vault is already open. Obsidian decides how to bring it up.
- **Unregistered vaults:** if a vault has never been opened in Obsidian, what happens is up to Obsidian, and I haven't verified that case yet.

## If a click doesn't work

If clicking a link shows a Windows message like "Get an app to open this 'bridge' link", the click wasn't caught. Two things help:

- Put your cursor on the link and run **Open Bridge link under cursor**. That always works.
- Run **Troubleshoot link clicks** from the command palette, click the link once, then run the command again. It copies a short report to your clipboard (versions and what happened to the click). It stays on your computer unless you paste it somewhere. It can include the paths of notes in your links, so skim it before you share it, then paste it into an issue.

Behind the scenes, Obsidian has no official way to handle custom link types, so the plugin watches for `bridge://` links at the last step before they would leave Obsidian and routes only those to itself. Every other link is left alone. The code is in `src/platform/externalOpenGuard.ts` if you want to see exactly what it does.

## Building it yourself

```
npm install
npm test
npm run build
```

You need Node 22.18 or newer. The logic lives in `src/core` and doesn't depend on Obsidian, which is what the tests cover; `src/main.ts` and `src/ui` are the thin layer that talks to Obsidian. See `CONTRIBUTING.md` for more.

## License

MIT. Made by Ansu Damanta.
