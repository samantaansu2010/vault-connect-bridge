export type BridgeErrorCode =
  | "invalid-link"
  | "unknown-connection"
  | "vault-missing"
  | "not-a-vault"
  | "note-missing"
  | "unsafe-path"
  | "invalid-path"
  | "duplicate"
  | "current-vault"
  | "invalid-label";

/** An error whose message is written for end users and can be shown as-is. */
export class BridgeError extends Error {
  code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
  }
}

/** Error for an existing connection whose folder is unreachable or no longer a vault. */
export function vaultProblem(
  status: "not-found" | "not-a-vault",
  label: string,
  vaultPath: string,
): BridgeError {
  if (status === "not-found") {
    return new BridgeError(
      "vault-missing",
      `Can't reach the vault "${label}" at ${vaultPath}. The folder may have been moved, renamed or deleted, or it is on a drive that isn't available on this computer. Use "Change location" in Vault Connect Bridge settings to point the connection at its current folder.`,
    );
  }
  return new BridgeError(
    "not-a-vault",
    `The folder for "${label}" (${vaultPath}) no longer looks like an Obsidian vault: it has no .obsidian folder. Check the connection in Vault Connect Bridge settings.`,
  );
}
