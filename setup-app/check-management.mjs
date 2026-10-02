import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
  readdir,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { VaultStore } from "./vault-store.mjs";
import { VaultManagement } from "./vault-management.mjs";
const root = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "vault-management-")),
);
try {
  const dist = path.join(root, "dist");
  await mkdir(dist);
  for (const [name, content] of Object.entries({
    "manifest.json": '{"name":"Excalidraw Codeblocks","version":"test"}',
    "main.js": "runtime",
    "styles.css": "styles",
  }))
    await writeFile(path.join(dist, name), content);
  const original = path.join(root, "Old vault");
  await mkdir(path.join(original, ".obsidian/codeblocks-backups/previous"), {
    recursive: true,
  });
  await writeFile(
    path.join(original, "Drawing.excalidraw.md"),
    "preserved drawing",
  );
  await writeFile(
    path.join(original, ".obsidian/codeblocks-backups/previous/main.js"),
    "preserved backup",
  );
  const registryPath = path.join(root, "obsidian.json");
  const originalRegistry = {
    vaults: {
      stableId: { path: original, open: true, ts: 123 },
      unrelated: { path: path.join(root, "Other"), customField: 42 },
    },
    updatePolicy: "keep",
  };
  await writeFile(registryPath, JSON.stringify(originalRegistry));
  const options = {
    registryPath,
    userData: path.join(root, "settings"),
    distDirectory: dist,
  };
  const store = new VaultStore(options);
  await store.init();
  await store.list();
  store.backups[original] = path.join(
    original,
    ".obsidian/codeblocks-backups/previous",
  );
  const manager = new VaultManagement(store, async () => {});
  const folder = await manager.folder("create", null, "Research");
  await manager.moveToFolder(original, folder);
  await assert.rejects(
    manager.folder("create", null, "research"),
    /already exists/,
  );
  await mkdir(path.join(root, "Existing"));
  await assert.rejects(manager.renameVault(original, "Existing"), {
    code: "EEXIST",
  });
  assert.equal(
    await readFile(path.join(original, "Drawing.excalidraw.md"), "utf8"),
    "preserved drawing",
  );
  await assert.rejects(
    manager.renameVault(original, "../escape"),
    /Use a name/,
  );
  const renamed = (await manager.renameVault(original, "New vault")).path;
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  assert.deepEqual(registry.vaults.stableId, {
    path: renamed,
    open: true,
    ts: 123,
  });
  assert.deepEqual(
    registry.vaults.unrelated,
    originalRegistry.vaults.unrelated,
  );
  assert.equal(registry.updatePolicy, "keep");
  assert.equal(store.assignments[renamed], folder);
  assert.equal(
    await readFile(path.join(store.backups[renamed], "main.js"), "utf8"),
    "preserved backup",
  );
  assert.equal(
    await readFile(path.join(renamed, "Drawing.excalidraw.md"), "utf8"),
    "preserved drawing",
  );
  const reloaded = new VaultStore(options);
  await reloaded.init();
  assert.equal(reloaded.assignments[renamed], folder);
  assert.equal(reloaded.folders[folder], "Research");
  const save = store.save.bind(store);
  store.save = async () => {
    throw new Error("Simulated disk failure");
  };
  await assert.rejects(
    manager.renameVault(renamed, "Must roll back"),
    /disk failure/,
  );
  assert.equal(
    JSON.parse(await readFile(registryPath, "utf8")).vaults.stableId.path,
    renamed,
  );
  assert.equal((await stat(renamed)).isDirectory(), true);
  await assert.rejects(manager.removeVault(renamed), /disk failure/);
  assert.equal(
    JSON.parse(await readFile(registryPath, "utf8")).vaults.stableId.path,
    renamed,
  );
  store.save = save;
  const blocked = new VaultManagement(store, async () => {
    throw new Error("Quit Obsidian");
  });
  await assert.rejects(
    blocked.renameVault(renamed, "Blocked"),
    /Quit Obsidian/,
  );
  await assert.rejects(blocked.removeVault(renamed), /Quit Obsidian/);
  const beforeInvalid = await readFile(registryPath, "utf8");
  await writeFile(registryPath, "invalid JSON");
  await assert.rejects(manager.removeVault(renamed));
  assert.equal(store.paths.has(renamed), true);
  await writeFile(registryPath, beforeInvalid);
  await manager.folder("rename", folder, "Work");
  await manager.folder("remove", folder);
  assert.equal(store.assignments[renamed], undefined);
  await manager.removeVault(renamed);
  assert.equal(
    (await stat(path.join(renamed, ".obsidian"))).isDirectory(),
    true,
  );
  assert.equal(
    await readFile(path.join(renamed, "Drawing.excalidraw.md"), "utf8"),
    "preserved drawing",
  );
  assert.equal(
    JSON.parse(await readFile(registryPath, "utf8")).vaults.stableId,
    undefined,
  );
  assert.equal(
    (await store.list()).vaults.some((vault) => vault.path === renamed),
    false,
  );
  assert.ok(
    (await readdir(path.join(options.userData, "registry-backups"))).length >=
      2,
  );
  await manager.restoreVault(renamed);
  assert.equal(
    (await store.list()).vaults.some((vault) => vault.path === renamed),
    true,
  );
  await assert.rejects(manager.removeVault("/unknown"), /gallery/);
  let calls = 0;
  await writeFile(
    registryPath,
    JSON.stringify({ vaults: { stableId: { path: renamed } } }),
  );
  const racing = new VaultManagement(store, async () => {
    if (++calls === 2)
      await writeFile(
        registryPath,
        JSON.stringify({
          vaults: { stableId: { path: renamed } },
          changedExternally: true,
        }),
      );
  });
  await assert.rejects(racing.renameVault(renamed, "Race"), /changed during/);
  assert.equal((await stat(renamed)).isDirectory(), true);
  assert.equal(
    JSON.parse(await readFile(registryPath, "utf8")).changedExternally,
    true,
  );
  console.log(
    "PASS: rename, unregister without deletion, folders, reload, collisions, validation, backups, rollback, closed-app guard, corrupt registry, concurrent edit protection",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
