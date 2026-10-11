import * as nodePath from "path";
import { BridgeError, vaultProblem } from "./errors.ts";
import type { FsPort } from "./fsPort.ts";
import { parseBridgeLink } from "./linkParser.ts";
import type { BridgeConnection } from "./types.ts";

export interface ResolvedTarget {
  connection: BridgeConnection;
  /** Vault-relative, "/" separated. May have ".md" appended if the link omitted it. */
  relativePath: string;
  absolutePath: string;
  anchor: string | null;
}

/**
 * Turns a Bridge link into a verified target on disk, or throws a BridgeError
 * with a user-facing message. Read-only: it only stats files.
 */
export async function resolveBridgeLink(
  url: string,
  connections: readonly BridgeConnection[],
  fs: FsPort,
): Promise<ResolvedTarget> {
  const parsed = parseBridgeLink(url);
  if (!parsed.ok) {
    switch (parsed.reason) {
      case "missing-path":
        throw new BridgeError(
          "invalid-link",
          "This Bridge link doesn't say which note to open. Expected bridge://<vault-id>/<folder>/<note>.md",
        );
      case "unsafe-path":
        throw new BridgeError(
          "unsafe-path",
          "This Bridge link contains a path that isn't allowed (\"..\", backslashes or encoded slashes), so it was not opened.",
        );
      default:
        throw new BridgeError(
          "invalid-link",
          "This isn't a valid Bridge link. Expected bridge://<vault-id>/<folder>/<note>.md",
        );
    }
  }

  const { link } = parsed;
  const connection = connections.find((c) => c.id === link.connectionId);
  if (!connection) {
    throw new BridgeError(
      "unknown-connection",
      `This link points to a vault (id ${link.connectionId}) that isn't connected on this computer. Add that vault in Vault Connect Bridge settings, or remove the link.`,
    );
  }

  if (!(await fs.isDirectory(connection.vaultPath))) {
    throw vaultProblem("not-found", connection.label, connection.vaultPath);
  }
  if (!(await fs.isDirectory(nodePath.join(connection.vaultPath, ".obsidian")))) {
    throw vaultProblem("not-a-vault", connection.label, connection.vaultPath);
  }

  const segments = link.path.split("/");
  const absolute = nodePath.join(connection.vaultPath, ...segments);
  const relative = nodePath.relative(connection.vaultPath, absolute);
  if (relative === ".." || relative.startsWith(".." + nodePath.sep) || nodePath.isAbsolute(relative)) {
    throw new BridgeError("unsafe-path", "This link points outside its vault, so it was not opened.");
  }

  const candidates = [{ abs: absolute, rel: link.path }];
  if (nodePath.extname(absolute) === "") {
    candidates.push({ abs: absolute + ".md", rel: link.path + ".md" });
  }
  for (const candidate of candidates) {
    if (await fs.isFile(candidate.abs)) {
      return {
        connection,
        relativePath: candidate.rel,
        absolutePath: candidate.abs,
        anchor: link.anchor,
      };
    }
  }

  throw new BridgeError(
    "note-missing",
    `"${link.path}" wasn't found in "${connection.label}". It may have been renamed, moved or deleted. Bridge doesn't track renames yet, so the link needs to be updated by hand.`,
  );
}
