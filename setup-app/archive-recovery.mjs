/** Recover pre-Archive removals from this app's own registry snapshots once. */
import { readFile, readdir, stat, realpath } from "node:fs/promises";
import path from "node:path";
export async function recoverArchive(store) {
  let current;
  let files;
  const directory = path.join(store.userData, "registry-backups");
  try {
    current = JSON.parse(await readFile(store.registryPath, "utf8"));
    files = await readdir(directory);
  } catch {
    return;
  }
  if (
    !current?.vaults ||
    typeof current.vaults !== "object" ||
    Array.isArray(current.vaults)
  )
    return;
  const activePaths = new Set(store.paths);
  for (const entry of Object.values(current.vaults)) {
    if (typeof entry?.path !== "string") continue;
    try {
      activePaths.add(await realpath(entry.path));
    } catch {
      activePaths.add(entry.path);
    }
  }
  const snapshots = [];
  for (const filename of files.filter((file) => file.endsWith(".json"))) {
    try {
      snapshots.push({
        filename,
        modified: (await stat(path.join(directory, filename))).mtimeMs,
      });
    } catch {
      /* Skip unavailable backups. */
    }
  }
  snapshots.sort((a, b) => b.modified - a.modified);
  for (const item of snapshots) {
    try {
      const snapshot = JSON.parse(
        await readFile(path.join(directory, item.filename), "utf8"),
      );
      for (const [id, entry] of Object.entries(snapshot.vaults ?? {})) {
        if (
          Object.hasOwn(current.vaults, id) ||
          typeof entry?.path !== "string" ||
          !path.isAbsolute(entry.path)
        )
          continue;
        let vault = entry.path;
        try {
          vault = await realpath(vault);
        } catch {
          /* Keep unavailable archived paths recoverable. */
        }
        if (activePaths.has(vault) || Object.hasOwn(store.archived, vault))
          continue;
        store.archived[vault] = {
          archivedAt: item.modified,
          entries: { [id]: entry },
          recovered: true,
        };
      }
    } catch {
      /* One malformed old backup must not prevent startup. */
    }
  }
}
