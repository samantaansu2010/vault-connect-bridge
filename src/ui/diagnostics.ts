/**
 * Bounded in-memory log used to collect evidence about how Obsidian renders and
 * dispatches bridge:// links. Nothing is written to disk or sent anywhere; the
 * user copies the report to the clipboard themselves via a command.
 */
export class DiagnosticsLog {
  processorCalls = 0;
  private entries: string[] = [];
  private max: number;
  private now: () => string;

  constructor(max = 200, now: () => string = () => new Date().toISOString()) {
    this.max = max;
    this.now = now;
  }

  add(kind: string, detail = ""): void {
    const text = detail.length > 600 ? detail.slice(0, 600) + "…" : detail;
    this.entries.push(`${this.now()} ${kind}${text ? " " + text : ""}`);
    if (this.entries.length > this.max) this.entries.shift();
  }

  size(): number {
    return this.entries.length;
  }

  report(header: Record<string, string>): string {
    const lines = ["# Vault Connect Bridge diagnostics"];
    for (const [key, value] of Object.entries(header)) lines.push(`${key}: ${value}`);
    lines.push(`markdown post-processor calls: ${this.processorCalls}`);
    lines.push("", "## Log (oldest first)");
    lines.push(...(this.entries.length ? this.entries : ["(empty)"]));
    return lines.join("\n");
  }
}
