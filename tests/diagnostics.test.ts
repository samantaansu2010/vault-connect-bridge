import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DiagnosticsLog } from "../src/ui/diagnostics.ts";

describe("DiagnosticsLog", () => {
  test("keeps only the newest entries", () => {
    const log = new DiagnosticsLog(3, () => "T");
    for (let i = 1; i <= 5; i++) log.add("e", String(i));
    assert.equal(log.size(), 3);
    const report = log.report({});
    assert.ok(!report.includes("T e 1") && !report.includes("T e 2"));
    assert.ok(report.includes("T e 3") && report.includes("T e 5"));
  });

  test("report has the header, the post-processor count and the entries", () => {
    const log = new DiagnosticsLog(10, () => "T");
    log.processorCalls = 7;
    log.add("anchor-before", "<a href=x>");
    const report = log.report({ plugin: "0.1.1", "obsidian api": "1.4.4" });
    assert.match(report, /^# Vault Connect Bridge diagnostics/);
    assert.ok(report.includes("plugin: 0.1.1"));
    assert.ok(report.includes("obsidian api: 1.4.4"));
    assert.ok(report.includes("markdown post-processor calls: 7"));
    assert.ok(report.includes("T anchor-before <a href=x>"));
  });

  test("truncates very long details and reports an empty log clearly", () => {
    const log = new DiagnosticsLog(10, () => "T");
    assert.ok(log.report({}).includes("(empty)"));
    log.add("big", "x".repeat(5000));
    assert.ok(log.report({}).length < 1000);
  });
});
