export type ConnectionStatus = "ok" | "not-found" | "not-a-vault" | "unknown";

export interface BridgeConnection {
  /** 8 lowercase hex chars, generated locally, never changes. Used in links. */
  id: string;
  /** User-editable display name. Never used in links, so renaming is always safe. */
  label: string;
  /** Folder name at connection time (informational). */
  vaultName: string;
  /** Absolute path on THIS machine. */
  vaultPath: string;
  status: ConnectionStatus;
  lastChecked?: number;
  /** Include this vault in Bridge search. Missing means on. */
  includeInSearch?: boolean;
}

export interface BridgeData {
  schemaVersion: 1;
  connections: BridgeConnection[];
}
