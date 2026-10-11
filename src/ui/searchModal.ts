import { App, Notice, SuggestModal } from "obsidian";
import { BridgeError } from "../core/errors.ts";
import { buildBridgeLink } from "../core/linkParser.ts";
import { isSearchEnabled, loadSearchableVault, searchNotes } from "../core/search.ts";
import type { SearchItem, VaultLoad } from "../core/search.ts";
import type VaultConnectBridgePlugin from "../main.ts";
import { nodeFs } from "../platform/nodeFs.ts";

const MAX_RESULTS = 50;

/**
 * Search note names/paths across connected vaults. Vault switches sit right above
 * the results; flipping one saves the same per-vault setting as Settings does.
 * Everything loaded lives in this object only and is dropped when the window closes.
 */
export class BridgeSearchModal extends SuggestModal<SearchItem> {
  private plugin: VaultConnectBridgePlugin;
  private loads = new Map<string, VaultLoad>();
  private pending = new Set<string>();
  private combined: SearchItem[] | null = null;
  private statusEl: HTMLElement | null = null;
  private closed = false;

  constructor(app: App, plugin: VaultConnectBridgePlugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder("Search notes in connected vaults…");
    this.emptyStateText = "No matching notes.";
  }

  onOpen(): void {
    super.onOpen();
    this.buildSwitches();
    this.loadEnabledVaults();
  }

  onClose(): void {
    super.onClose();
    this.closed = true;
    this.loads.clear();
    this.combined = null;
  }

  // ---- vault switches ----

  private buildSwitches(): void {
    const row = createDiv({ cls: "bridge-search-chips" });
    for (const connection of this.plugin.registry.list()) {
      const chip = row.createEl("button", { cls: "bridge-chip", text: connection.label });
      chip.setAttribute("type", "button");
      const paint = (on: boolean) => {
        chip.classList.toggle("is-on", on);
        chip.setAttribute("aria-pressed", String(on));
        chip.setAttribute("aria-label", `${connection.label}: ${on ? "included in" : "left out of"} search`);
      };
      paint(isSearchEnabled(connection));

      chip.addEventListener("click", async () => {
        const now = this.plugin.registry.get(connection.id);
        if (!now) return;
        const next = !isSearchEnabled(now);
        try {
          await this.plugin.registry.setIncludeInSearch(connection.id, next);
        } catch (e) {
          new Notice(e instanceof BridgeError ? e.message : "Couldn't change that setting.");
          return;
        }
        paint(next);
        if (next) this.loadEnabledVaults();
        this.refresh();
        this.inputEl.focus();
      });
    }

    this.statusEl = createDiv({ cls: "bridge-search-status" });
    this.resultContainerEl.before(row, this.statusEl);
  }

  // ---- on-demand loading (file NAMES only, never contents) ----

  private loadEnabledVaults(): void {
    for (const connection of this.plugin.registry.list()) {
      if (!isSearchEnabled(connection) || this.loads.has(connection.id) || this.pending.has(connection.id)) continue;
      this.pending.add(connection.id);
      void loadSearchableVault(nodeFs, connection).then((load) => {
        this.pending.delete(connection.id);
        if (this.closed) return;
        this.loads.set(connection.id, load);
        this.refresh();
      });
    }
    this.updateStatus();
  }

  private refresh(): void {
    this.combined = null;
    this.inputEl.dispatchEvent(new Event("input")); // re-runs getSuggestions
  }

  private enabledConnections() {
    return this.plugin.registry.list().filter(isSearchEnabled);
  }

  private allItems(): SearchItem[] {
    if (this.combined) return this.combined;
    let items: SearchItem[] = [];
    for (const connection of this.enabledConnections()) {
      const load = this.loads.get(connection.id);
      if (load?.ok) items = items.concat(load.items);
    }
    this.combined = items;
    return items;
  }

  private updateStatus(): void {
    const enabled = this.enabledConnections();
    const parts: string[] = [];
    const loading = enabled.filter((c) => this.pending.has(c.id)).map((c) => c.label);
    if (loading.length > 0) parts.push(`Loading ${loading.join(", ")}…`);
    for (const connection of enabled) {
      const load = this.loads.get(connection.id);
      if (load && !load.ok) parts.push(`${connection.label} is unavailable. Check it in settings.`);
      if (load?.ok && load.truncated) parts.push(`${connection.label} is very large; results are partial.`);
    }
    this.statusEl?.setText(parts.join(" · "));
    this.emptyStateText =
      enabled.length === 0
        ? "All vaults are switched off. Turn one on above."
        : loading.length > 0
          ? "Loading…"
          : "No matching notes.";
  }

  // ---- SuggestModal ----

  getSuggestions(query: string): SearchItem[] {
    this.updateStatus();
    return searchNotes(this.allItems(), query, MAX_RESULTS);
  }

  renderSuggestion(item: SearchItem, el: HTMLElement): void {
    el.createDiv({ cls: "bridge-search-title", text: item.name });
    const folder = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "";
    el.createDiv({
      cls: "bridge-search-meta",
      text: folder ? `${item.vaultLabel} · ${folder}` : item.vaultLabel,
    });
  }

  onChooseSuggestion(item: SearchItem): void {
    try {
      void this.plugin.openBridgeLink(buildBridgeLink(item.connectionId, item.path));
    } catch (e) {
      console.error("Vault Connect Bridge:", e);
      new Notice("Couldn't open that note.");
    }
  }
}
