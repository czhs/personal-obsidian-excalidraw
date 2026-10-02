/** Local installer shared by the CLI and macOS setup navigator. */
import { copyFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const PLUGIN_ID = "obsidian-excalidraw-plugin";
const RUNTIME_FILES = ["main.js", "styles.css", "manifest.json"];

async function exists(filename) {
  try { await stat(filename); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

/** Install a built bundle, preserving settings and backing up an existing runtime. */
export async function installCodeblocks(distDirectory, suppliedPath, { create = false } = {}) {
  let vaultDirectory = path.resolve(suppliedPath);
  if (!create && path.basename(vaultDirectory) === ".obsidian") vaultDirectory = path.dirname(vaultDirectory);
  for (const filename of RUNTIME_FILES) {
    if (!(await stat(path.join(distDirectory, filename))).isFile()) throw new Error(`Missing artifact: ${filename}`);
  }
  const manifest = JSON.parse(await readFile(path.join(distDirectory, "manifest.json"), "utf8"));
  if (manifest.id !== PLUGIN_ID) throw new Error("Unexpected plugin ID in build artifacts.");
  const obsidianDirectory = path.join(vaultDirectory, ".obsidian");
  const enabledPath = path.join(obsidianDirectory, "community-plugins.json");
  let enabled = [];
  if (!create) {
    if (!(await stat(vaultDirectory)).isDirectory()) throw new Error("Select a vault folder.");
    try { enabled = JSON.parse(await readFile(enabledPath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!Array.isArray(enabled) || enabled.some((id) => typeof id !== "string")) {
      throw new Error("community-plugins.json must be an array of plugin IDs. No files were changed.");
    }
  }
  // Non-recursive creation refuses an existing destination instead of merging into it.
  if (create) await mkdir(vaultDirectory);
  const pluginDirectory = path.join(obsidianDirectory, "plugins", PLUGIN_ID);
  const token = randomUUID();
  const stagingDirectory = `${pluginDirectory}.setup-${token}`;
  const temporaryEnabledPath = `${enabledPath}.setup-${token}`;
  let backupDirectory;
  let installed = false;
  try {
    await mkdir(stagingDirectory, { recursive: true });
    if (await exists(pluginDirectory)) {
      backupDirectory = path.join(obsidianDirectory, "codeblocks-backups", token);
      await mkdir(path.dirname(backupDirectory), { recursive: true });
      await cp(pluginDirectory, backupDirectory, { recursive: true });
      if (await exists(enabledPath)) await copyFile(enabledPath, `${backupDirectory}-community-plugins.json`);
      await cp(pluginDirectory, stagingDirectory, { recursive: true });
    }
    for (const filename of RUNTIME_FILES) await copyFile(path.join(distDirectory, filename), path.join(stagingDirectory, filename));
    if (!enabled.includes(PLUGIN_ID)) enabled.push(PLUGIN_ID);
    await writeFile(temporaryEnabledPath, `${JSON.stringify(enabled, null, 2)}\n`);
    installed = true;
    await rm(pluginDirectory, { recursive: true, force: true });
    await rename(stagingDirectory, pluginDirectory);
    await rename(temporaryEnabledPath, enabledPath);
  } catch (error) {
    if (installed) {
      await rm(pluginDirectory, { recursive: true, force: true });
      if (backupDirectory) await cp(backupDirectory, pluginDirectory, { recursive: true });
    }
    throw error;
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
    await rm(temporaryEnabledPath, { force: true });
  }
  return { vaultDirectory, pluginDirectory, backupDirectory };
}
