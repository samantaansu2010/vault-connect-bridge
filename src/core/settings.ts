/** User preferences. Stored beside the connections in this plugin's own data.json. */

export type LinkLabelStyle = "note" | "vault-and-note";

/** "bridge" = bridge://id/path (default). "protocol" = obsidian://vault-connect-bridge?... (experimental). */
export type LinkFormat = "bridge" | "protocol";

export interface BridgeSettings {
  /** Ribbon (left sidebar) button that inserts a link to a note in another vault. */
  showRibbonButton: boolean;
  /** Ribbon button that opens Bridge search across connected vaults. */
  showSearchButton: boolean;
  /** Right-click items in the editor: insert a link, or open the Bridge link under the cursor. */
  showEditorMenu: boolean;
  /** Text used for newly inserted links when nothing is selected. */
  linkLabelStyle: LinkLabelStyle;
  /** Format of newly inserted links. Existing links of either format keep working. */
  linkFormat: LinkFormat;
}

export const DEFAULT_SETTINGS: BridgeSettings = {
  showRibbonButton: true,
  showSearchButton: true,
  showEditorMenu: true,
  linkLabelStyle: "note",
  linkFormat: "bridge",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads `settings` out of raw data.json, falling back to defaults field by field. */
export function normalizeSettings(raw: unknown): BridgeSettings {
  const source = isRecord(raw) && isRecord(raw.settings) ? raw.settings : {};
  return {
    showRibbonButton:
      typeof source.showRibbonButton === "boolean" ? source.showRibbonButton : DEFAULT_SETTINGS.showRibbonButton,
    showSearchButton:
      typeof source.showSearchButton === "boolean" ? source.showSearchButton : DEFAULT_SETTINGS.showSearchButton,
    showEditorMenu:
      typeof source.showEditorMenu === "boolean" ? source.showEditorMenu : DEFAULT_SETTINGS.showEditorMenu,
    linkLabelStyle:
      source.linkLabelStyle === "note" || source.linkLabelStyle === "vault-and-note"
        ? source.linkLabelStyle
        : DEFAULT_SETTINGS.linkLabelStyle,
    linkFormat:
      source.linkFormat === "bridge" || source.linkFormat === "protocol"
        ? source.linkFormat
        : DEFAULT_SETTINGS.linkFormat,
  };
}

/** Default text for a new link: the note name, optionally prefixed with the vault label. */
export function defaultLinkLabel(
  style: LinkLabelStyle,
  notePath: string,
  connectionLabel: string,
): string {
  const fileName = notePath.split("/").pop() ?? notePath;
  const note = fileName.replace(/\.md$/i, "");
  return style === "vault-and-note" ? `${connectionLabel}: ${note}` : note;
}
