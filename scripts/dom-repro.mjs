// Real-browser (Chromium) reproduction of the Reading View click problem.
//
//   npm i --no-save playwright && npx playwright install chromium
//   node scripts/dom-repro.mjs
//
// This is NOT Obsidian. It runs the REAL src/ui/readingView.ts in real Chromium
// against hostile "host" behaviours that Obsidian might plausibly have (a handler
// registered before the plugin, a delegated handler, late re-decoration), and counts
// how often the link would be handed to the OS ("Get an app to open this link").
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let ts, chromium;
try { ts = require("typescript"); } catch { console.error("Needs the 'typescript' package (npm install)."); process.exit(2); }
try { ({ chromium } = require("playwright")); } catch { console.error("Needs playwright: npm i --no-save playwright && npx playwright install chromium"); process.exit(2); }

const source = readFileSync(path.join(root, "src/ui/readingView.ts"), "utf8");
const guardSource = readFileSync(path.join(root, "src/platform/externalOpenGuard.ts"), "utf8");
const transpile = (src) =>
  ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } }).outputText;
// Both files go into one module script; the guard's import of isBridgeUrl is satisfied by the first file.
const moduleJs =
  transpile(source) +
  "\n" +
  transpile(guardSource).replace(/^import .*;$/m, "") +
  "\nwindow.__rv = { decorateBridgeAnchors, bridgeUrlFromTarget, installBridgeOpenGuard };";

const URL_ = "bridge://a1b2c3d4/Economics/Inflation.md";
// Reading View: Obsidian renders an <a>. Live Preview / Source: a span whose URL lives in editor state.
const READING_HTML = `<div id="view"><p>See <a class="external-link" href="${URL_}" target="_blank" rel="noopener nofollow">Inflation</a></p></div>`;
const EDITOR_HTML = `<div id="view"><p>See <span class="cm-link" data-url="${URL_}">Inflation</span></p></div>`;

// Everything below runs inside the page.
async function scenario(page, host, strategy) {
  const HTML = host === "host-editor-window-open" ? EDITOR_HTML : READING_HTML;
  await page.setContent("<!doctype html><body></body>");
  await page.addScriptTag({ type: "module", content: moduleJs });
  await page.waitForFunction(() => window.__rv);
  return page.evaluate(
    ({ host, strategy, HTML }) => {
      const out = { osHandoffs: [], pluginOpens: [] };
      const realOpen = window.open;
      window.open = (u) => { if (/^bridge:/i.test(String(u))) out.osHandoffs.push("window.open(" + u + ")"); return null; };
      document.body.innerHTML = HTML;
      const view = document.getElementById("view");

      // ---- hostile "Obsidian" behaviours, installed BEFORE the plugin ----
      if (host === "host-window-capture") {
        window.addEventListener("click", (e) => {
          const a = e.target.closest && e.target.closest("a.external-link, a[href]");
          if (a) window.open(a.getAttribute("href"));
        }, true);
      }
      if (host === "host-editor-window-open") {
        // Models Obsidian's editor link handling seen in the real diagnostics: no <a>, no
        // post-processor; the click handler reads the URL from state and calls window.open.
        view.addEventListener("click", (e) => {
          const el = e.target.closest && e.target.closest(".cm-link");
          if (el) window.open(el.getAttribute("data-url"));
        }, false);
      }
      if (host === "host-bubble-delegate") {
        view.addEventListener("click", (e) => {
          const a = e.target.closest && e.target.closest("a[href]");
          if (a) window.open(a.getAttribute("href"));
        }, false);
      }

      if (host === "host-late-redecorate") {
        // listener exists from the start (like Obsidian's own); the re-decoration happens later
        window.addEventListener("click", (e) => {
          const a = e.target.closest && e.target.closest("a[href]");
          if (a) window.open(a.getAttribute("href"));
        }, true);
      }

      // ---- plugin strategies ----
      const open = (u) => out.pluginOpens.push(u);
      const rv = window.__rv;
      if (strategy === "v0.1.0: document capture listener") {
        document.addEventListener("click", (e) => {
          const u = rv.bridgeUrlFromTarget(e.target);
          if (u) { e.preventDefault(); e.stopPropagation(); open(u); }
        }, true);
      } else if (strategy === "v0.1.1-prev: strip attrs, keep <a>") {
        for (const a of view.querySelectorAll('a[href^="bridge://"]')) {
          const u = a.getAttribute("href");
          a.setAttribute("data-bridge-url", u);
          for (const n of ["href", "target", "rel"]) a.removeAttribute(n);
          a.classList.remove("external-link");
          a.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); open(u); });
        }
        window.addEventListener("click", (e) => {
          const u = rv.bridgeUrlFromTarget(e.target);
          if (u) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); open(u); }
        }, true);
      } else if (strategy === "v0.1.2: span + window.open guard (real code)") {
        rv.installBridgeOpenGuard(window, open);
        rv.decorateBridgeAnchors(view, { open });
        window.addEventListener("click", (e) => {
          const u = rv.bridgeUrlFromTarget(e.target);
          if (u) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); open(u); }
        }, true);
      } else if (strategy === "v0.1.1: anchor -> span (real code)") {
        rv.decorateBridgeAnchors(view, { open });
        window.addEventListener("click", (e) => {
          const u = rv.bridgeUrlFromTarget(e.target);
          if (u) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); open(u); }
        }, true);
      }

      // host that re-decorates links after post-processors ran
      if (host === "host-late-redecorate") {
        for (const a of view.querySelectorAll("a[data-bridge-url]")) {
          a.setAttribute("href", a.getAttribute("data-bridge-url"));
          a.classList.add("external-link");
        }
      }

      // ---- the click ----
      const target = view.querySelector("[data-bridge-url], a, .cm-link");
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
      target.dispatchEvent(ev);
      const hadBridgeHref = !!(target.getAttribute && /^bridge:/i.test(target.getAttribute("href") || ""));
      if (hadBridgeHref && !ev.defaultPrevented) out.osHandoffs.push("default action on <a href=bridge://>");
      window.open = realOpen;
      return { ...out, targetTag: target.tagName };
    },
    { host, strategy, HTML },
  );
}

const hosts = ["host-none", "host-window-capture", "host-bubble-delegate", "host-late-redecorate", "host-editor-window-open"];
const strategies = [
  "v0.1.0: document capture listener",
  "v0.1.1-prev: strip attrs, keep <a>",
  "v0.1.1: anchor -> span (real code)",
  "v0.1.2: span + window.open guard (real code)",
];

const browser = await chromium.launch();
let spanFailures = 0;
console.log("Chromium", await browser.version(), "(real DOM + real event dispatch; not Obsidian)\n");
console.log("host behaviour".padEnd(22), "strategy".padEnd(38), "OS hand-offs".padEnd(14), "plugin opens", " result");
for (const host of hosts) {
  for (const strategy of strategies) {
    const page = await browser.newPage();
    const r = await scenario(page, host, strategy);
    await page.close();
    const ok = r.osHandoffs.length === 0 && r.pluginOpens.length === 1;
    if (strategy.startsWith("v0.1.2:") && !ok) spanFailures++;
    console.log(host.padEnd(22), strategy.padEnd(38), String(r.osHandoffs.length).padEnd(14), String(r.pluginOpens.length).padEnd(12), ok ? " PASS" : " FAIL  " + r.osHandoffs.join("; "));
  }
}
await browser.close();
console.log(spanFailures === 0 ? "\nv0.1.2 (span + window.open guard): no OS hand-off in any scenario." : `\nv0.1.2 FAILED ${spanFailures} scenario(s).`);
process.exit(spanFailures === 0 ? 0 : 1);
