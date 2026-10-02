import assert from "node:assert/strict";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { VaultStore } from "./vault-store.mjs";
import { VaultManagement } from "./vault-management.mjs";
const root = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "vault-archive-")),
);
try {
  const dist = path.join(root, "dist");
  const vault = path.join(root, "A vault");
  await mkdir(dist);
  await mkdir(path.join(vault, ".obsidian"), { recursive: true });
  await writeFile(path.join(vault, "drawing.md"), "keep forever");
  for (const [name, content] of Object.entries({
    "manifest.json": '{"name":"Excalidraw Codeblocks","version":"test"}',
    "main.js": "runtime",
    "styles.css": "css",
  }))
    await writeFile(path.join(dist, name), content);
  const registryPath = path.join(root, "obsidian.json");
  await writeFile(
    registryPath,
    JSON.stringify({
      vaults: { original: { path: vault, open: true, custom: "keep" } },
      unrelated: true,
    }),
  );
  const options = {
    registryPath,
    userData: path.join(root, "data"),
    distDirectory: dist,
  };
  const store = new VaultStore(options);
  await store.init();
  await store.list();
  const manager = new VaultManagement(store, async () => {});
  const folder = await manager.folder("create", null, "Personal");
  await manager.moveToFolder(vault, folder);
  await manager.removeVault(vault);
  assert.equal((await store.list()).vaults.length, 0);
  assert.equal((await store.list()).archived[0].folder, folder);
  assert.equal(
    await readFile(path.join(vault, "drawing.md"), "utf8"),
    "keep forever",
  );
  await assert.rejects(store.add(vault), /archived/);
  const reloaded = new VaultStore(options);
  await reloaded.init();
  assert.equal((await reloaded.list()).archived[0].path, vault);
  const save = store.save.bind(store);
  store.save = async () => {
    throw new Error("Persistence failure");
  };
  await assert.rejects(manager.restoreVault(vault), /Persistence failure/);
  assert.equal(
    JSON.parse(await readFile(registryPath, "utf8")).vaults.original,
    undefined,
  );
  assert.ok(store.archived[vault]);
  assert.equal(store.paths.has(vault), false);
  store.save = save;
  await manager.restoreVault(vault);
  const restored = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(restored.vaults.original.path, vault);
  assert.equal(restored.vaults.original.custom, "keep");
  assert.equal(restored.vaults.original.open, false);
  assert.equal(restored.unrelated, true);
  assert.equal((await store.list()).vaults[0].folder, folder);
  assert.equal((await store.list()).archived.length, 0);
  await assert.rejects(manager.restoreVault(vault), /Archive tab/);
  await manager.removeVault(vault);
  // A deleted dashboard folder must not be recreated by restore.
  await manager.folder("remove", folder);
  await rename(vault, `${vault}-away`);
  await assert.rejects(manager.restoreVault(vault));
  assert.ok(store.archived[vault]);
  await rename(`${vault}-away`, vault);
  // Preserve a registry ID reassigned to another vault while this one was archived.
  await writeFile(
    registryPath,
    JSON.stringify({
      vaults: {
        original: { path: path.join(root, "another"), important: true },
      },
    }),
  );
  await manager.restoreVault(vault);
  const collision = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(collision.vaults.original.important, true);
  assert.equal(
    Object.values(collision.vaults).filter((entry) => entry.path === vault)
      .length,
    1,
  );
  assert.equal(store.assignments[vault], undefined);
  // The pre-Archive app stored registry snapshots. Recover absent entries, not renamed/active ones.
  const legacy = path.join(root, "legacy");
  await mkdir(path.join(legacy, "registry-backups"), { recursive: true });
  await writeFile(
    path.join(legacy, "vaults.json"),
    JSON.stringify({ paths: [], folders: {}, assignments: {} }),
  );
  const removed = path.join(root, "Previously removed");
  await mkdir(path.join(removed, ".obsidian"), { recursive: true });
  await writeFile(
    path.join(legacy, "registry-backups/before.json"),
    JSON.stringify({
      vaults: {
        removedId: { path: removed },
        original: { path: path.join(root, "Old name") },
      },
    }),
  );
  const migrated = new VaultStore({ ...options, userData: legacy });
  await migrated.init();
  assert.deepEqual(Object.keys(migrated.archived), [removed]);
  const migratedManager = new VaultManagement(migrated, async () => {});
  await migratedManager.restoreVault(removed);
  assert.equal(
    JSON.parse(await readFile(registryPath, "utf8")).vaults.removedId.path,
    removed,
  );
  const migratedAgain = new VaultStore({ ...options, userData: legacy });
  await migratedAgain.init();
  assert.equal(Object.keys(migratedAgain.archived).length, 0);
  console.log(
    "PASS: archive persistence, restore registration and folder, no deletion, rollback, missing folder, duplicate/unknown restore, ID collision, recovery of previous removals",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
