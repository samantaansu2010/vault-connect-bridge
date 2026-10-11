import * as nodePath from "path";
import { BridgeError } from "./errors.ts";
import type { FsPort } from "./fsPort.ts";
import { isValidConnectionId } from "./linkParser.ts";
import type { BridgeConnection, BridgeData, ConnectionStatus } from "./types.ts";

const STATUSES: readonly string[] = ["ok", "not-found", "not-a-vault", "unknown"];
const MAX_LABEL_LENGTH = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Defensive load: a corrupted or hand-edited data.json must never crash the plugin. */
export function normalizeData(raw: unknown): BridgeData {
  const connections: BridgeConnection[] = [];
  const seen = new Set<string>();
  const items = isRecord(raw) && Array.isArray(raw.connections) ? raw.connections : [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const { id, label, vaultName, vaultPath, status, lastChecked, includeInSearch } = item;
    if (typeof id !== "string" || !isValidConnectionId(id) || seen.has(id)) continue;
    if (typeof vaultPath !== "string" || vaultPath === "") continue;
    seen.add(id);
    const name =
      typeof vaultName === "string" && vaultName !== "" ? vaultName : nodePath.basename(vaultPath);
    connections.push({
      id,
      label: typeof label === "string" && label.trim() !== "" ? label.trim() : name,
      vaultName: name,
      vaultPath,
      status:
        typeof status === "string" && STATUSES.includes(status)
          ? (status as ConnectionStatus)
          : "unknown",
      ...(typeof lastChecked === "number" ? { lastChecked } : {}),
      ...(typeof includeInSearch === "boolean" ? { includeInSearch } : {}),
    });
  }
  return { schemaVersion: 1, connections };
}

/** Accepts a pasted path, tolerating surrounding quotes ("Copy as path" on Windows adds them). */
export function normalizeVaultPath(input: string): string {
  let value = input.trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (value === "") {
    throw new BridgeError("invalid-path", "Enter the full path to the vault folder.");
  }
  if (!nodePath.isAbsolute(value)) {
    throw new BridgeError(
      "invalid-path",
      "Enter the full path to the vault folder, for example /Users/me/Vaults/Research or C:\\Vaults\\Research.",
    );
  }
  return nodePath.resolve(value);
}

function foldCase(path: string): string {
  return process.platform === "win32" || process.platform === "darwin" ? path.toLowerCase() : path;
}

async function checkVaultFolder(
  fs: FsPort,
  vaultPath: string,
): Promise<"ok" | "not-found" | "not-a-vault"> {
  if (!(await fs.isDirectory(vaultPath))) return "not-found";
  if (!(await fs.isDirectory(nodePath.join(vaultPath, ".obsidian")))) return "not-a-vault";
  return "ok";
}

export interface RegistryOptions {
  /** Absolute path of the vault Bridge is running in (cannot be connected to itself). */
  currentVaultPath: string | null;
  fs: FsPort;
  save: (data: BridgeData) => Promise<void>;
  randomBytes?: (length: number) => Uint8Array;
  now?: () => number;
}

export class ConnectionRegistry {
  private connections: BridgeConnection[];
  private opts: RegistryOptions;

  constructor(raw: unknown, opts: RegistryOptions) {
    this.connections = normalizeData(raw).connections;
    this.opts = opts;
  }

  list(): BridgeConnection[] {
    return this.connections.map((c) => ({ ...c }));
  }

  get(id: string): BridgeConnection | undefined {
    const found = this.connections.find((c) => c.id === id);
    return found ? { ...found } : undefined;
  }

  async add(input: string, label?: string): Promise<BridgeConnection> {
    const vaultPath = normalizeVaultPath(input);
    this.assertUsablePath(vaultPath, null);
    await this.assertIsVault(vaultPath);
    // Re-check: a second Add (double-click) may have finished while we were awaiting the disk.
    this.assertUsablePath(vaultPath, null);

    const name = nodePath.basename(vaultPath) || vaultPath;
    const connection: BridgeConnection = {
      id: this.newId(),
      label: label?.trim() ? this.validLabel(label) : name,
      vaultName: name,
      vaultPath,
      status: "ok",
      lastChecked: this.now(),
    };
    this.connections.push(connection);
    await this.persist();
    return { ...connection };
  }

  async remove(id: string): Promise<void> {
    this.mustGet(id);
    this.connections = this.connections.filter((c) => c.id !== id);
    await this.persist();
  }

  async rename(id: string, label: string): Promise<void> {
    const connection = this.mustGet(id);
    connection.label = this.validLabel(label);
    await this.persist();
  }

  /** Switches a vault in or out of Bridge search. Writes data.json only if the value changed. */
  async setIncludeInSearch(id: string, include: boolean): Promise<void> {
    const connection = this.mustGet(id);
    if ((connection.includeInSearch !== false) === include) return;
    connection.includeInSearch = include;
    await this.persist();
  }

  /** Re-points a connection at a new folder, keeping its id so existing links keep working. */
  async relocate(id: string, input: string): Promise<BridgeConnection> {
    const connection = this.mustGet(id);
    const vaultPath = normalizeVaultPath(input);
    this.assertUsablePath(vaultPath, id);
    await this.assertIsVault(vaultPath);
    this.assertUsablePath(vaultPath, id); // same race as add()
    connection.vaultPath = vaultPath;
    connection.vaultName = nodePath.basename(vaultPath) || vaultPath;
    connection.status = "ok";
    connection.lastChecked = this.now();
    await this.persist();
    return { ...connection };
  }

  /** Re-checks one connection. Writes data.json only if its status actually changed. */
  async test(id: string): Promise<ConnectionStatus> {
    const connection = this.mustGet(id);
    if (await this.refreshStatus(connection)) await this.persist();
    return connection.status;
  }

  /** Re-checks every connection. Writes data.json only if any status actually changed. */
  async testAll(): Promise<void> {
    let changed = false;
    for (const connection of this.connections) {
      changed = (await this.refreshStatus(connection)) || changed;
    }
    if (changed) await this.persist();
  }

  // ---- internals ----

  /** Updates status in memory; returns true if it changed (the only reason to touch the disk). */
  private async refreshStatus(connection: BridgeConnection): Promise<boolean> {
    const next = await checkVaultFolder(this.opts.fs, connection.vaultPath);
    const changed = next !== connection.status;
    connection.status = next;
    connection.lastChecked = this.now();
    return changed;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private mustGet(id: string): BridgeConnection {
    const found = this.connections.find((c) => c.id === id);
    if (!found) {
      throw new BridgeError("unknown-connection", "That vault connection no longer exists.");
    }
    return found;
  }

  private validLabel(label: string): string {
    const trimmed = label.trim();
    if (trimmed === "" || trimmed.length > MAX_LABEL_LENGTH) {
      throw new BridgeError(
        "invalid-label",
        `Enter a name between 1 and ${MAX_LABEL_LENGTH} characters.`,
      );
    }
    return trimmed;
  }

  private assertUsablePath(vaultPath: string, ignoreId: string | null): void {
    const current = this.opts.currentVaultPath;
    if (current && foldCase(nodePath.resolve(current)) === foldCase(vaultPath)) {
      throw new BridgeError(
        "current-vault",
        "That's the vault you're in right now. Connect a different vault.",
      );
    }
    const clash = this.connections.find(
      (c) => c.id !== ignoreId && foldCase(nodePath.resolve(c.vaultPath)) === foldCase(vaultPath),
    );
    if (clash) {
      throw new BridgeError("duplicate", `That vault is already connected as "${clash.label}".`);
    }
  }

  private async assertIsVault(vaultPath: string): Promise<void> {
    const status = await checkVaultFolder(this.opts.fs, vaultPath);
    if (status === "not-found") {
      throw new BridgeError(
        "vault-missing",
        `Couldn't find or read a folder at ${vaultPath}. Check the path and try again.`,
      );
    }
    if (status === "not-a-vault") {
      throw new BridgeError(
        "not-a-vault",
        `${vaultPath} isn't an Obsidian vault: it has no .obsidian folder. Open the folder as a vault in Obsidian once, then try again.`,
      );
    }
  }

  private newId(): string {
    const taken = new Set(this.connections.map((c) => c.id));
    const random =
      this.opts.randomBytes ?? ((n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n)));
    for (let attempt = 0; attempt < 20; attempt++) {
      const id = Array.from(random(4), (b) => b.toString(16).padStart(2, "0")).join("");
      if (!taken.has(id)) return id;
    }
    throw new Error("Could not generate a unique connection id.");
  }

  private async persist(): Promise<void> {
    await this.opts.save({
      schemaVersion: 1,
      connections: this.connections.map((c) => ({ ...c })),
    });
  }
}
