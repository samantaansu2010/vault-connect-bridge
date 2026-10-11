import type { FsPort } from "./fsPort.ts";
import { resolveBridgeLink } from "./resolver.ts";
import type { ResolvedTarget } from "./resolver.ts";
import type { BridgeConnection } from "./types.ts";
import { buildObsidianOpenUri } from "./uri.ts";

/**
 * Bridge link -> verified target -> `obsidian://open?path=...`.
 * `openUri` is the only side effect and is injected, so this is testable without Obsidian.
 * Throws BridgeError (user-facing message) and calls `openUri` only if every check passed.
 */
export async function navigateBridgeLink(
  url: string,
  connections: readonly BridgeConnection[],
  fs: FsPort,
  openUri: (uri: string) => void,
  options: { followAnchors?: boolean } = {},
): Promise<ResolvedTarget> {
  const target = await resolveBridgeLink(url, connections, fs);
  const file =
    options.followAnchors && target.anchor
      ? target.absolutePath + "#" + target.anchor
      : target.absolutePath;
  openUri(buildObsidianOpenUri(file));
  return target;
}
