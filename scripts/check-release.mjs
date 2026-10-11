// Fails loudly on the mistakes that most often break an Obsidian plugin release.
//   RELEASE_TAG=0.3.0 node scripts/check-release.mjs     (also run by .github/workflows/release.yml)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const json = (file) => JSON.parse(read(file));

const manifest = json("manifest.json");
const pkg = json("package.json");
const versions = json("versions.json");
const problems = [];

const tag = process.env.RELEASE_TAG;
if (tag && tag !== manifest.version) {
  problems.push(`Tag "${tag}" must equal manifest.json version "${manifest.version}" exactly (no leading "v").`);
}
if (pkg.version !== manifest.version) {
  problems.push(`package.json version "${pkg.version}" differs from manifest.json "${manifest.version}".`);
}
if (versions[manifest.version] !== manifest.minAppVersion) {
  problems.push(`versions.json must map "${manifest.version}" to minAppVersion "${manifest.minAppVersion}".`);
}
if (!manifest.author || /^todo$/i.test(manifest.author.trim())) {
  problems.push('manifest.json "author" is still a placeholder. Set your name.');
}
if (!read("CHANGELOG.md").includes(`## ${manifest.version}`)) {
  problems.push(`CHANGELOG.md has no "## ${manifest.version}" section.`);
}

if (problems.length > 0) {
  console.error("Release check failed:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log(`Release check passed for ${manifest.id} ${manifest.version}.`);
