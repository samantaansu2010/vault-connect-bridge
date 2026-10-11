# Contributing

```
npm install
npm test            # Node's built-in runner; needs Node 22.18+
npm run typecheck
npm run build
```

- Core logic lives in `src/core` and must not import `obsidian`. File access goes through the read-only `FsPort`, so tests use an in-memory filesystem (`tests/helpers/memfs.ts`).
- Anything that touches Obsidian is a thin layer in `src/main.ts` and `src/ui`. Keep it small; put logic in core where it can be tested.
- Paths: use Node's `path` and compare against `path.resolve(...)` in tests so they pass on Windows and POSIX.
- Principles that changes must respect: local-first, no network, read-only for other vaults, no scanning beyond what the user explicitly opens.
- `node scripts/dom-repro.mjs` replays the link-click mechanisms in real Chromium (needs `playwright`; it is not Obsidian).
- Releases: update `manifest.json`, `package.json`, `versions.json` and `CHANGELOG.md`, then tag the exact version (for example `0.3.0`, no leading `v`). `npm run release:check` verifies this.
