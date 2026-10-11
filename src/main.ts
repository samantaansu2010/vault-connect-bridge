import { Editor, FileSystemAdapter, MarkdownView, Menu, Notice, Plugin, apiVersion } from "obsidian";
import { BridgeError, vaultProblem } from "./core/errors.ts";
import { buildBridgeLink, escapeLabel, parseBridgeLink } from "./core/linkParser.ts";
import { navigateBridgeLink } from "./core/navigate.ts";
import { listNotes } from "./core/notes.ts";
import {
  PROTOCOL_ACTION,
  buildProtocolLink,
  findLinks,
  protocolParamsToLink,
  toBridgeUrl,
} from "./core/protocol.ts";
import { ConnectionRegistry } from "./core/registry.ts";
import { defaultLinkLabel, normalizeSettings } from "./core/settings.ts";
import type { BridgeSettings } from "./core/settings.ts";
import { installBridgeOpenGuard } from "./platform/externalOpenGuard.ts";
import { nodeFs } from "./platform/nodeFs.ts";
import { DiagnosticsLog } from "./ui/diagnostics.ts";
import { pickFromList } from "./ui/modals.ts";
import { bridgeUrlFromTarget, decorateBridgeAnchors } from "./ui/readingView.ts";
import { BridgeSearchModal } from "./ui/searchModal.ts";
import { BridgeSettingTab } from "./ui/settings.ts";

/**
 * Heading/block anchors are parsed and preserved in links, but NOT yet passed to
 * Obsidian: how `obsidian://open?path=` treats "#anchor" is unverified. Opening
 * the note reliably comes first. See docs/feasibility-spike.md.
 */
const FOLLOW_ANCHORS = false;

const CLICK_LIKE_EVENTS = ["click", "auxclick"] as const;
const RECORDED_EVENTS = ["pointerdown", "mousedown", "mouseup", "click", "auxclick"] as const;

export default class VaultConnectBridgePlugin extends Plugin {
  registry!: ConnectionRegistry;
  settings!: BridgeSettings;
  private ribbonEl: HTMLElement | null = null;
  private searchRibbonEl: HTMLElement | null = null;
  private diag = new DiagnosticsLog();
  private stopRecording: (() => void) | null = null;

  async onload(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice("Vault Connect Bridge needs a desktop vault stored on the local file system.");
      return;
    }

    const raw: unknown = await this.loadData();
    this.settings = normalizeSettings(raw);
    this.registry = new ConnectionRegistry(raw, {
      currentVaultPath: adapter.getBasePath(),
      fs: nodeFs,
      // data.json holds connections AND settings; never write one without the other.
      save: (data) => this.saveData({ ...data, settings: this.settings }),
    });
    this.diag.add("load", `plugin ${this.manifest.version}, obsidian api ${apiVersion}`);

    // First, so nothing later in onload can prevent it: catches bridge:// at window.open,
    // the choke point proven (by real-Obsidian diagnostics) to see editor/Live Preview clicks.
    this.guardWindow(window);
    this.diag.add("guard-installed", "main window");

    // EXPERIMENTAL second route: Obsidian's own public protocol handler for
    // obsidian://vault-connect-bridge?... links (opt in via Settings → Link format).
    this.registerObsidianProtocolHandler(PROTOCOL_ACTION, (params) => this.onProtocolLink(params));

    this.addSettingTab(new BridgeSettingTab(this.app, this));

    this.addCommand({
      id: "insert-link",
      name: "Insert link to a note in another vault",
      editorCallback: (editor) => void this.insertLink(editor),
    });

    this.addCommand({
      id: "search-vaults",
      name: "Search connected vaults",
      callback: () => this.openSearch(),
    });

    this.addCommand({
      id: "open-link-under-cursor",
      name: "Open Bridge link under cursor",
      editorCallback: (editor) => this.openLinkUnderCursor(editor),
    });

    this.addCommand({
      id: "reading-view-diagnostics",
      name: "Troubleshoot link clicks (run to start, run again to copy report)",
      callback: () => void this.toggleDiagnostics(),
    });

    // Quick access for people who don't use the command palette (each part is optional in settings).
    this.applyUiSettings();
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => this.addEditorMenuItems(menu, editor)),
    );

    // Reading View: replace each bridge:// anchor with a self-handling span (ui/readingView.ts).
    this.registerMarkdownPostProcessor((el) => {
      this.diag.processorCalls++;
      decorateBridgeAnchors(el, {
        open: (url) => void this.openBridgeLink(url),
        describe: (url) => {
          const parsed = parseBridgeLink(url);
          if (!parsed.ok) return null;
          const connection = this.registry.get(parsed.link.connectionId);
          return connection
            ? `${connection.label}: ${parsed.link.path}`
            : "Bridge link to a vault that isn't connected on this computer";
        },
        trace: (event, detail) => this.diag.add(event, detail),
      });
    });

    // Safety net for any bridge:// anchor that still reaches the page undecorated.
    this.listenForClicks(window);
    this.registerEvent(
      this.app.workspace.on("window-open", (_workspaceWindow, win) => {
        this.guardWindow(win);
        this.listenForClicks(win);
      }),
    );

    // Notes already rendered before this plugin loaded were never post-processed.
    this.app.workspace.onLayoutReady(() => this.rerenderOpenPreviews());
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ schemaVersion: 1, connections: this.registry.list(), settings: this.settings });
  }

  /** Adds or removes the ribbon buttons to match settings. Safe to call repeatedly. */
  applyUiSettings(): void {
    if (this.settings.showRibbonButton && !this.ribbonEl) {
      this.ribbonEl = this.addRibbonIcon("link", "Insert link to a note in another vault", () =>
        this.insertFromRibbon(),
      );
    } else if (!this.settings.showRibbonButton && this.ribbonEl) {
      this.ribbonEl.remove();
      this.ribbonEl = null;
    }

    if (this.settings.showSearchButton && !this.searchRibbonEl) {
      this.searchRibbonEl = this.addRibbonIcon("search", "Search connected vaults", () => this.openSearch());
    } else if (!this.settings.showSearchButton && this.searchRibbonEl) {
      this.searchRibbonEl.remove();
      this.searchRibbonEl = null;
    }
  }

  openSearch(): void {
    if (this.registry.list().length === 0) {
      new Notice("No vaults are connected yet. Add one in Settings → Vault Connect Bridge.");
      return;
    }
    new BridgeSearchModal(this.app, this).open();
  }

  private insertFromRibbon(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.getMode() !== "source") {
      new Notice("Open a note in editing mode, then click again.");
      return;
    }
    void this.insertLink(view.editor);
  }

  private addEditorMenuItems(menu: Menu, editor: Editor): void {
    if (!this.settings.showEditorMenu) return;

    const cursor = editor.getCursor();
    const link = findLinks(editor.getLine(cursor.line)).find(
      (l) => cursor.ch >= l.start && cursor.ch <= l.end,
    );
    if (link) {
      menu.addItem((item) =>
        item.setTitle("Open Bridge link").setIcon("external-link").onClick(() => void this.openBridgeLink(link.url)),
      );
    }
    if (this.registry.list().length > 0) {
      menu.addItem((item) =>
        item.setTitle("Search connected vaults").setIcon("search").onClick(() => this.openSearch()),
      );
      menu.addItem((item) =>
        item
          .setTitle("Insert link to a note in another vault")
          .setIcon("link")
          .onClick(() => void this.insertLink(editor)),
      );
    }
  }

  onunload(): void {
    this.stopRecording?.();
  }

  private rerenderOpenPreviews(): void {
    try {
      this.app.workspace.iterateAllLeaves((leaf) => {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.getMode() === "preview") {
          view.previewMode.rerender(true);
        }
      });
    } catch (e) {
      console.error("Vault Connect Bridge: could not refresh open Reading Views", e);
    }
  }

  private guardWindow(win: Window): void {
    const uninstall = installBridgeOpenGuard(win, (url) => {
      this.diag.add("window.open intercepted", url);
      void this.openBridgeLink(url);
    });
    this.register(uninstall); // runs automatically when the plugin unloads
  }

  private listenForClicks(win: Window): void {
    for (const type of CLICK_LIKE_EVENTS) {
      this.registerDomEvent(
        win,
        type,
        (evt: MouseEvent) => {
          const url = bridgeUrlFromTarget(evt.target);
          if (!url) return;
          this.diag.add("safety-net", `${evt.type} intercepted at window capture`);
          evt.preventDefault();
          evt.stopPropagation();
          evt.stopImmediatePropagation();
          void this.openBridgeLink(url);
        },
        { capture: true },
      );
    }
  }

  private onProtocolLink(params: Record<string, string>): void {
    this.diag.add("protocol-handler", `vault=${params.vault ?? "(none)"} id=${params.id ?? "(none)"}`);
    const parsed = protocolParamsToLink(params);
    if (!parsed.ok) {
      new Notice("This Vault Connect Bridge link is incomplete or invalid, so it was not opened.");
      return;
    }
    void this.openBridgeLink(buildBridgeLink(parsed.link.connectionId, parsed.link.path, parsed.link.anchor));
  }

  /** Accepts either link format; both go through the same resolver and navigation. */
  async openBridgeLink(url: string): Promise<void> {
    try {
      const canonical = toBridgeUrl(url) ?? url; // an invalid link falls through to the resolver's clear error
      await navigateBridgeLink(canonical, this.registry.list(), nodeFs, (uri) => window.open(uri), {
        followAnchors: FOLLOW_ANCHORS,
      });
    } catch (e) {
      this.reportError(e);
    }
  }

  // ---- diagnostics: local only, user-initiated, copied to the clipboard by the user ----

  private async toggleDiagnostics(): Promise<void> {
    if (this.stopRecording) {
      this.stopRecording();
      this.stopRecording = null;
      const report = this.diag.report({
        plugin: this.manifest.version,
        "obsidian api": apiVersion,
        platform: navigator.userAgent,
        connections: String(this.registry.list().length),
      });
      try {
        await navigator.clipboard.writeText(report);
        new Notice("Diagnostics report copied to the clipboard. Paste it into your reply.", 8000);
      } catch {
        console.info(report);
        new Notice("Couldn't use the clipboard. The report was printed to the developer console (Ctrl+Shift+I).", 10000);
      }
      return;
    }

    const cleanups: Array<() => void> = [];
    for (const type of RECORDED_EVENTS) {
      const capture = (e: Event) => this.logEvent("capture", e);
      const bubble = (e: Event) => this.logEvent("bubble", e);
      window.addEventListener(type, capture, true);
      window.addEventListener(type, bubble, false);
      cleanups.push(() => window.removeEventListener(type, capture, true));
      cleanups.push(() => window.removeEventListener(type, bubble, false));
    }
    const original = window.open;
    const wrapped: typeof window.open = (...args) => {
      this.diag.add("window.open", String(args[0]));
      return original.apply(window, args);
    };
    window.open = wrapped;
    cleanups.push(() => {
      if (window.open === wrapped) window.open = original;
    });

    this.diag.add("recording-started");
    this.stopRecording = () => {
      cleanups.forEach((fn) => fn());
      this.diag.add("recording-stopped");
    };
    new Notice(
      "Recording. Switch to Reading View, click your Bridge link once, then run this command again to copy the report.",
      10000,
    );
  }

  private logEvent(phase: string, e: Event): void {
    const el = (e.target as Element | null)?.closest?.("a, [data-bridge-url]");
    if (!el) return;
    const html = el.outerHTML;
    if (!/bridge/i.test(html)) return;
    this.diag.add(
      `event:${phase}`,
      `${e.type} button=${(e as MouseEvent).button} defaultPrevented=${e.defaultPrevented} trusted=${e.isTrusted} target=${(e.target as Element).tagName} | ${html}`,
    );
  }

  // ---- commands ----

  private openLinkUnderCursor(editor: Editor): void {
    const cursor = editor.getCursor();
    const found = findLinks(editor.getLine(cursor.line)).find(
      (link) => cursor.ch >= link.start && cursor.ch <= link.end,
    );
    if (!found) {
      new Notice("There is no Bridge link at the cursor.");
      return;
    }
    void this.openBridgeLink(found.url);
  }

  private async insertLink(editor: Editor): Promise<void> {
    try {
      const connections = this.registry.list();
      if (connections.length === 0) {
        new Notice("No vaults are connected yet. Add one in Settings → Vault Connect Bridge.");
        return;
      }

      const connection =
        connections.length === 1
          ? connections[0]
          : await pickFromList(this.app, connections, (c) => `${c.label} — ${c.vaultPath}`, "Choose a vault");
      if (!connection) return;

      // Read-only, on demand, one vault: only now do we look at the target's file list.
      const status = await this.registry.test(connection.id);
      if (status === "not-found" || status === "not-a-vault") {
        throw vaultProblem(status, connection.label, connection.vaultPath);
      }
      const listing = await listNotes(nodeFs, connection.vaultPath);
      if (listing.notes.length === 0) {
        new Notice(`No Markdown notes were found in "${connection.label}".`);
        return;
      }
      if (listing.truncated) {
        new Notice(`"${connection.label}" is very large; only the first ${listing.notes.length} notes are listed.`);
      }

      const note = await pickFromList(
        this.app,
        listing.notes,
        (n) => n,
        `Search notes in ${connection.label}`,
      );
      if (!note) return;

      const selected = editor.getSelection().replace(/\s*\n\s*/g, " ").trim();
      const label =
        selected !== "" ? selected : defaultLinkLabel(this.settings.linkLabelStyle, note, connection.label);
      const link =
        this.settings.linkFormat === "protocol"
          ? buildProtocolLink(this.app.vault.getName(), connection.id, note)
          : buildBridgeLink(connection.id, note);
      editor.replaceSelection(`[${escapeLabel(label)}](${link})`);
    } catch (e) {
      this.reportError(e);
    }
  }

  private reportError(e: unknown): void {
    if (e instanceof BridgeError) {
      new Notice(e.message, 12000);
    } else {
      console.error("Vault Connect Bridge:", e);
      new Notice("Vault Connect Bridge: something went wrong. See the developer console for details.");
    }
  }
}
