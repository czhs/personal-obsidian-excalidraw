import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installCodeblocks } from "./install-codeblocks.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "codeblocks-install-"));
try {
  const dist = path.join(root, "dist");
  await mkdir(dist);
  for (const [name, content] of Object.entries({ "main.js": "custom runtime", "styles.css": "custom styles", "manifest.json": '{"id":"obsidian-excalidraw-plugin"}' })) await writeFile(path.join(dist, name), content);
  const vault = path.join(root, "Vault with spaces ' $ and ü");
  const first = await installCodeblocks(dist, vault, { create: true });
  const enabled = path.join(vault, ".obsidian/community-plugins.json");
  assert.deepEqual(JSON.parse(await readFile(enabled)), ["obsidian-excalidraw-plugin"]);
  await assert.rejects(installCodeblocks(dist, vault, { create: true }), { code: "EEXIST" });
  await writeFile(path.join(first.pluginDirectory, "data.json"), '{"personalSetting":true}');
  await writeFile(path.join(first.pluginDirectory, "main.js"), "old runtime");
  await writeFile(path.join(vault, "Old drawing.excalidraw.md"), "unchanged drawing");
  await writeFile(enabled, '["other-plugin", "obsidian-excalidraw-plugin"]');
  const upgraded = await installCodeblocks(dist, path.join(vault, ".obsidian"));
  assert.equal(await readFile(path.join(upgraded.backupDirectory, "main.js"), "utf8"), "old runtime");
  assert.equal(await readFile(path.join(first.pluginDirectory, "main.js"), "utf8"), "custom runtime");
  assert.equal(await readFile(path.join(first.pluginDirectory, "data.json"), "utf8"), '{"personalSetting":true}');
  assert.equal(await readFile(path.join(vault, "Old drawing.excalidraw.md"), "utf8"), "unchanged drawing");
  assert.deepEqual(JSON.parse(await readFile(enabled)), ["other-plugin", "obsidian-excalidraw-plugin"]);
  await writeFile(enabled, '{"invalid":true}');
  await writeFile(path.join(first.pluginDirectory, "main.js"), "must survive");
  await assert.rejects(installCodeblocks(dist, vault), /array of plugin IDs/);
  assert.equal(await readFile(path.join(first.pluginDirectory, "main.js"), "utf8"), "must survive");
  console.log("PASS: creation, collision refusal, upgrade, backup, settings/drawing preservation, plugin list, invalid config refusal");
} finally { await rm(root, { recursive: true, force: true }); }
