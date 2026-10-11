import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { BridgeError, vaultProblem } from "../core/errors.ts";
import { findLinks, parseAnyBridgeLink } from "../core/protocol.ts";
import type { BridgeConnection, ConnectionStatus } from "../core/types.ts";
import type VaultConnectBridgePlugin from "../main.ts";
import { confirm, promptText } from "./modals.ts";

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  ok: "Connected",
  "not-found": "Not found on this computer",
  "not-a-vault": "Folder is not an Obsidian vault",
  unknown: "Not checked yet",
};

export class BridgeSettingTab extends PluginSettingTab {
  private plugin: VaultConnectBridgePlugin;
  private listEl: HTMLElement | null = null;
  private searchEl: HTMLElement | null = null;
  private counts: Map<string, number> | null = null;
  private token = 0;

  constructor(app: App, plugin: VaultConnectBridgePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Connected vaults").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Link to notes in other vaults on this computer. Nothing is copied, uploaded or changed. The vault must already be in Obsidian's vault switcher.",
    });

    let pathInput = "";
    new Setting(containerEl)
      .setName("Add a vault")
      .setDesc("Full path of the vault folder (the one containing .obsidian).")
      .addText((text) =>
        text.setPlaceholder("/Users/me/Vaults/Research").onChange((value) => (pathInput = value)),
      )
      .addButton((button) =>
        button
          .setButtonText("Add")
          .setCta()
          .onClick(async () => {
            try {
              const connection = await this.plugin.registry.add(pathInput);
              new Notice(`Connected "${connection.label}".`);
              this.display();
            } catch (e) {
              this.reportError(e);
            }
          }),
      );

    this.listEl = containerEl.createDiv();
    this.searchEl = containerEl.createDiv();
    this.counts = null;
    this.renderList();
    this.renderQuickAccess(containerEl);
    void this.refresh();
  }

  private renderQuickAccess(parent: HTMLElement): void {
    const settings = this.plugin.settings;
    new Setting(parent).setName("Quick access").setHeading();

    new Setting(parent)
      .setName("Ribbon button")
      .setDesc("Show a button in the left sidebar to insert a link to a note in another vault.")
      .addToggle((toggle) =>
        toggle.setValue(settings.showRibbonButton).onChange(async (value) => {
          settings.showRibbonButton = value;
          await this.plugin.saveSettings();
          this.plugin.applyUiSettings();
        }),
      );

    new Setting(parent)
      .setName("Search button")
      .setDesc("Show a button in the left sidebar to search connected vaults.")
      .addToggle((toggle) =>
        toggle.setValue(settings.showSearchButton).onChange(async (value) => {
          settings.showSearchButton = value;
          await this.plugin.saveSettings();
          this.plugin.applyUiSettings();
        }),
      );

    new Setting(parent)
      .setName("Right-click menu")
      .setDesc("Add \"Search connected vaults\", \"Insert link\" and \"Open Bridge link\" to the editor's right-click menu.")
      .addToggle((toggle) =>
        toggle.setValue(settings.showEditorMenu).onChange(async (value) => {
          settings.showEditorMenu = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(parent)
      .setName("New link text")
      .setDesc("Text for inserted links when nothing is selected.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("note", "Note name")
          .addOption("vault-and-note", "Vault name: note name")
          .setValue(settings.linkLabelStyle)
          .onChange(async (value) => {
            settings.linkLabelStyle = value === "vault-and-note" ? "vault-and-note" : "note";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(parent)
      .setName("Link format (experimental)")
      .setDesc(
        "bridge:// is the default. Try obsidian:// if clicking a bridge:// link shows an operating system prompt. " +
          "obsidian:// links include this vault's name, so they only work when clicked from this vault. " +
          "Links you already made, in either format, keep working.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("bridge", "bridge:// (default)")
          .addOption("protocol", "obsidian:// (uses Obsidian's own link handling)")
          .setValue(settings.linkFormat)
          .onChange(async (value) => {
            settings.linkFormat = value === "protocol" ? "protocol" : "bridge";
            await this.plugin.saveSettings();
          }),
      );
  }

  hide(): void {
    this.token++; // abandon any background refresh
    this.listEl = null;
    this.searchEl = null;
  }

  /** Re-checks every connection and counts links, both local and on-demand only. */
  private async refresh(): Promise<void> {
    const token = ++this.token;
    try {
      await this.plugin.registry.testAll();
      if (token !== this.token) return;
      this.renderList();
      if (this.plugin.registry.list().length === 0) return; // nothing to count
      const counts = await this.countReferences(token);
      if (!counts || token !== this.token) return;
      this.counts = counts;
      this.renderList();
    } catch (e) {
      console.error("Vault Connect Bridge: refresh failed", e);
    }
  }

  /** Counts Bridge links in the CURRENT vault's own notes. Other vaults are not read. */
  private async countReferences(token: number): Promise<Map<string, number> | null> {
    const counts = new Map<string, number>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (token !== this.token) return null;
      const text = await this.app.vault.cachedRead(file);
      if (!text.includes("bridge")) continue; // matches both bridge:// and obsidian://vault-connect-bridge
      for (const found of findLinks(text)) {
        const parsed = parseAnyBridgeLink(found.url);
        if (parsed.ok) {
          const id = parsed.link.connectionId;
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
    }
    return counts;
  }

  private renderList(): void {
    const el = this.listEl;
    if (!el) return;
    el.empty();
    const connections = this.plugin.registry.list();
    if (connections.length === 0) {
      el.createEl("p", { cls: "setting-item-description", text: "No vaults connected yet." });
      this.searchEl?.empty();
      return;
    }
    for (const connection of connections) this.renderRow(el, connection);
    this.renderSearchSwitches();
  }

  /** One switch per vault: whether it appears in Bridge search (also togglable inside the search window). */
  private renderSearchSwitches(): void {
    const el = this.searchEl;
    if (!el) return;
    el.empty();
    const connections = this.plugin.registry.list();
    if (connections.length === 0) return;

    new Setting(el).setName("Search").setHeading();
    el.createEl("p", {
      cls: "setting-item-description",
      text: "Choose which vaults appear when you search connected vaults. You can also switch them in the search window itself.",
    });
    for (const connection of connections) {
      new Setting(el).setName(connection.label).addToggle((toggle) =>
        toggle.setValue(connection.includeInSearch !== false).onChange(async (value) => {
          try {
            await this.plugin.registry.setIncludeInSearch(connection.id, value);
          } catch (e) {
            this.reportError(e);
          }
        }),
      );
    }
  }

  private renderRow(parent: HTMLElement, c: BridgeConnection): void {
    const setting = new Setting(parent).setName(c.label);
    setting.descEl.createDiv({ cls: "bridge-path", text: c.vaultPath });

    const count = this.counts?.get(c.id) ?? 0;
    const refs = this.counts && count > 0 ? ` · ${count} link${count === 1 ? "" : "s"}` : "";
    setting.descEl.createDiv({
      cls: ["bridge-status", `bridge-status-${c.status}`],
      text: STATUS_TEXT[c.status] + refs,
    });

    setting
      .addExtraButton((b) =>
        b.setIcon("refresh-cw").setTooltip("Test connection").onClick(async () => {
          try {
            const status = await this.plugin.registry.test(c.id);
            if (status === "ok") {
              new Notice(`"${c.label}" is reachable.`);
            } else if (status === "not-found" || status === "not-a-vault") {
              new Notice(vaultProblem(status, c.label, c.vaultPath).message, 10000);
            }
            this.renderList();
          } catch (e) {
            this.reportError(e);
          }
        }),
      )
      .addExtraButton((b) =>
        b.setIcon("pencil").setTooltip("Rename").onClick(async () => {
          const value = await promptText(this.app, {
            title: "Rename connection",
            description: "This only changes the name shown here. Existing links keep working.",
            initial: c.label,
            submitLabel: "Rename",
          });
          if (value === null) return;
          try {
            await this.plugin.registry.rename(c.id, value);
            this.renderList();
          } catch (e) {
            this.reportError(e);
          }
        }),
      )
      .addExtraButton((b) =>
        b.setIcon("folder-open").setTooltip("Change location").onClick(async () => {
          const value = await promptText(this.app, {
            title: "Change location",
            description:
              "Point this connection at the vault's current folder. Existing links keep working because the connection id stays the same.",
            initial: c.vaultPath,
            submitLabel: "Update",
          });
          if (value === null) return;
          try {
            await this.plugin.registry.relocate(c.id, value);
            new Notice(`Updated the location of "${c.label}".`);
            this.renderList();
          } catch (e) {
            this.reportError(e);
          }
        }),
      )
      .addExtraButton((b) =>
        b.setIcon("trash-2").setTooltip("Remove connection").onClick(async () => {
          const ok = await confirm(this.app, {
            title: `Remove "${c.label}"?`,
            message:
              "This only removes the connection from Vault Connect Bridge. No files are deleted or changed in either vault. " +
              "Existing links to this vault will stop opening until it is connected again.",
            confirmLabel: "Remove",
          });
          if (!ok) return;
          try {
            await this.plugin.registry.remove(c.id);
            this.renderList();
          } catch (e) {
            this.reportError(e);
          }
        }),
      );
  }

  private reportError(e: unknown): void {
    if (e instanceof BridgeError) {
      new Notice(e.message, 10000);
    } else {
      console.error("Vault Connect Bridge:", e);
      new Notice("Vault Connect Bridge: something went wrong. See the developer console for details.");
    }
  }
}
