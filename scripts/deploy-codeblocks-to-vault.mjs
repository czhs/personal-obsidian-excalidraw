import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ID = "obsidian-excalidraw-plugin";
const RUNTIME_FILES = ["main.js", "styles.css", "manifest.json"];
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, "..");

function fail(message) {
  console.error(`\nExcalidraw Codeblocks deployment failed: ${message}\n`);
  process.exit(1);
}

const suppliedPath = process.argv[2];
if (!suppliedPath) {
  fail(
    'Provide an Obsidian vault path. Example:\n  npm run deploy:vault -- "/Users/me/Documents/My Vault"',
  );
}

let vaultDirectory = path.resolve(suppliedPath);
if (path.basename(vaultDirectory) === ".obsidian") {
  vaultDirectory = path.dirname(vaultDirectory);
}

try {
  const vaultStats = await stat(vaultDirectory);
  if (!vaultStats.isDirectory()) {
    fail(`Not a directory: ${vaultDirectory}`);
  }
} catch {
  fail(`Vault directory does not exist: ${vaultDirectory}`);
}

console.log("Building the production plugin bundle...");
try {
  execFileSync("npm", ["run", "build"], {
    cwd: projectDirectory,
    stdio: "inherit",
  });
} catch {
  fail("The production build did not complete successfully.");
}

const distDirectory = path.join(projectDirectory, "dist");
for (const filename of RUNTIME_FILES) {
  try {
    await stat(path.join(distDirectory, filename));
  } catch {
    fail(`Missing build artifact: dist/${filename}`);
  }
}

const obsidianDirectory = path.join(vaultDirectory, ".obsidian");
const pluginDirectory = path.join(obsidianDirectory, "plugins", PLUGIN_ID);
await mkdir(pluginDirectory, { recursive: true });

for (const filename of RUNTIME_FILES) {
  await copyFile(
    path.join(distDirectory, filename),
    path.join(pluginDirectory, filename),
  );
}

const enabledPluginsPath = path.join(
  obsidianDirectory,
  "community-plugins.json",
);
let enabledPlugins = [];
try {
  const parsed = JSON.parse(await readFile(enabledPluginsPath, "utf8"));
  if (
    !Array.isArray(parsed) ||
    parsed.some((value) => typeof value !== "string")
  ) {
    fail(`${enabledPluginsPath} is not a JSON array of plugin IDs.`);
  }
  enabledPlugins = parsed;
} catch (error) {
  if (error?.code !== "ENOENT") {
    fail(`Could not read ${enabledPluginsPath}: ${error.message}`);
  }
}

if (!enabledPlugins.includes(PLUGIN_ID)) {
  enabledPlugins.push(PLUGIN_ID);
}

const temporaryEnabledPluginsPath = `${enabledPluginsPath}.codeblocks.tmp`;
await writeFile(
  temporaryEnabledPluginsPath,
  `${JSON.stringify(enabledPlugins, null, 2)}\n`,
  "utf8",
);
await rename(temporaryEnabledPluginsPath, enabledPluginsPath);

console.log(`\nInstalled Excalidraw Codeblocks into:\n${pluginDirectory}`);
console.log(
  "Existing data.json settings were preserved. Reload Obsidian if this vault is already open.\n",
);
