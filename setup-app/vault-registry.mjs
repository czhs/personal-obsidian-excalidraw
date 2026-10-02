/** Backed-up, optimistic registry updates shared by rename, archive, and restore. */
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  realpath,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
async function readRegistry(filename) {
  try {
    return await readFile(filename, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function registryChange(
  store,
  directory,
  destination,
  ensureClosed,
  restore = null,
) {
  const before = await readRegistry(store.registryPath);
  const registry = before === null ? { vaults: {} } : JSON.parse(before);
  if (
    !registry ||
    typeof registry !== "object" ||
    Array.isArray(registry) ||
    (registry.vaults !== undefined &&
      (!registry.vaults ||
        typeof registry.vaults !== "object" ||
        Array.isArray(registry.vaults)))
  )
    throw new Error(
      "Obsidian’s vault registry is invalid. No changes were made.",
    );
  registry.vaults ??= {};
  const entries = {};
  let changed = false;
  for (const [id, entry] of Object.entries(registry.vaults)) {
    if (typeof entry?.path !== "string") continue;
    let entryPath = path.resolve(entry.path);
    try {
      entryPath = await realpath(entryPath);
    } catch {
      /* Missing vaults can still be archived. */
    }
    if (entryPath !== directory) continue;
    entries[id] = { ...entry };
    if (restore) continue;
    if (destination) entry.path = destination;
    else delete registry.vaults[id];
    changed = true;
  }
  if (restore && Object.keys(entries).length === 0) {
    const saved = Object.entries(restore.entries ?? {})[0];
    let id = saved?.[0] ?? randomUUID().replaceAll("-", "").slice(0, 16);
    if (Object.hasOwn(registry.vaults, id))
      id = randomUUID().replaceAll("-", "").slice(0, 16);
    registry.vaults[id] = {
      ...(saved?.[1] ?? {}),
      path: directory,
      ts: Date.now(),
      open: false,
    };
    changed = true;
  }
  if (!changed)
    return { entries, commit: async () => {}, rollback: async () => {} };
  const after = JSON.stringify(registry);
  if (before !== null) {
    const backups = path.join(store.userData, "registry-backups");
    await mkdir(backups, { recursive: true });
    await writeFile(path.join(backups, `${randomUUID()}.json`), before, {
      mode: 0o600,
    });
  }
  const replace = async (expected, content) => {
    await ensureClosed();
    const temporary = `${store.registryPath}.${randomUUID()}.tmp`;
    try {
      await mkdir(path.dirname(store.registryPath), { recursive: true });
      if (content !== null)
        await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
      if ((await readRegistry(store.registryPath)) !== expected)
        throw new Error(
          "Obsidian’s vault list changed during this operation. Refresh and try again.",
        );
      if (content === null) await rm(store.registryPath);
      else await rename(temporary, store.registryPath);
    } finally {
      await rm(temporary, { force: true });
    }
  };
  return {
    entries,
    commit: () => replace(before, after),
    rollback: () => replace(after, before),
  };
}
