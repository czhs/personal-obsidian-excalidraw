/** Vault folder/registry changes are backed up and rolled back together on failure. */
import { mkdir, rename, rmdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { registryChange } from "./vault-registry.mjs";

export function validateName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (
    !name ||
    name.startsWith(".") ||
    /[/:\x00-\x1f]/.test(name) ||
    name.length > 160
  )
    throw new Error(
      "Use a name of 1–160 characters without slashes, colons, or a leading dot.",
    );
  return name;
}

function snapshot(store) {
  return {
    paths: new Set(store.paths),
    archived: { ...store.archived },
    backups: { ...store.backups },
    folders: { ...store.folders },
    assignments: { ...store.assignments },
    covers: { ...store.covers },
    reloadPending: { ...store.reloadPending },
  };
}

/** Serial callers may rename/unregister vaults and maintain dashboard-only folders. */
export class VaultManagement {
  constructor(store, ensureClosed) {
    this.store = store;
    this.ensureClosed = ensureClosed;
  }

  requireKnown(directory) {
    if (typeof directory !== "string" || !this.store.paths.has(directory))
      throw new Error("Select a vault from your gallery first.");
  }

  async renameVault(selected, suppliedName) {
    this.requireKnown(selected);
    await this.ensureClosed();
    const store = this.store;
    const directory = await store.normalize(selected);
    const destination = path.join(
      path.dirname(directory),
      validateName(suppliedName),
    );
    if (directory === destination) return { path: directory };
    const update = await registryChange(
      store,
      directory,
      destination,
      this.ensureClosed,
    );
    // Reserve the name exclusively, including against files and symlinks. Never overwrite another folder.
    await mkdir(destination);
    const previous = snapshot(store);
    let moved = false;
    let registryWritten = false;
    try {
      await rename(directory, destination);
      moved = true;
      await update.commit();
      registryWritten = true;
      store.paths.delete(selected);
      store.paths.add(destination);
      if (store.assignments[selected])
        store.assignments[destination] = store.assignments[selected];
      delete store.assignments[selected];
      for (const field of ["covers", "reloadPending"]) {
        if (store[field][selected])
          store[field][destination] = store[field][selected];
        delete store[field][selected];
      }
      if (store.backups[selected])
        store.backups[destination] = path.join(
          destination,
          path.relative(directory, store.backups[selected]),
        );
      delete store.backups[selected];
      await store.save();
      return { path: destination };
    } catch (error) {
      Object.assign(store, previous);
      try {
        if (moved) await rename(destination, directory);
        else await rmdir(destination);
        if (registryWritten) await update.rollback();
      } catch (rollbackError) {
        throw new Error(
          `Rename could not be fully restored: ${rollbackError.message}. Check ${directory} and ${destination}. Registry backups are in ${store.userData}/registry-backups.`,
        );
      }
      throw error;
    }
  }

  async removeVault(directory) {
    this.requireKnown(directory);
    await this.ensureClosed();
    const store = this.store;
    const update = await registryChange(
      store,
      directory,
      null,
      this.ensureClosed,
    );
    const previous = snapshot(store);
    await update.commit();
    try {
      store.paths.delete(directory);
      store.archived[directory] = {
        archivedAt: Date.now(),
        entries: update.entries,
      };
      await store.save();
    } catch (error) {
      Object.assign(store, previous);
      await update.rollback();
      throw error;
    }
  }

  async restoreVault(selected) {
    const store = this.store;
    if (
      typeof selected !== "string" ||
      !Object.hasOwn(store.archived, selected)
    )
      throw new Error("Choose a vault from the Archive tab.");
    await this.ensureClosed();
    const directory = await store.normalize(selected);
    const update = await registryChange(
      store,
      directory,
      null,
      this.ensureClosed,
      store.archived[selected],
    );
    const previous = snapshot(store);
    await update.commit();
    try {
      delete store.archived[selected];
      store.paths.add(directory);
      if (selected !== directory) {
        if (store.assignments[selected])
          store.assignments[directory] = store.assignments[selected];
        delete store.assignments[selected];
        for (const field of ["covers", "reloadPending"]) {
          if (store[field][selected])
            store[field][directory] = store[field][selected];
          delete store[field][selected];
        }
        if (store.backups[selected])
          store.backups[directory] = path.join(
            directory,
            path.relative(selected, store.backups[selected]),
          );
        delete store.backups[selected];
      }
      await store.save();
      return { path: directory };
    } catch (error) {
      Object.assign(store, previous);
      await update.rollback();
      throw error;
    }
  }

  async folder(action, id, suppliedName) {
    const store = this.store;
    const previous = snapshot(store);
    try {
      if (action === "create" || action === "rename") {
        const name = validateName(suppliedName);
        if (
          Object.entries(store.folders).some(
            ([key, value]) =>
              key !== id && value.toLowerCase() === name.toLowerCase(),
          )
        )
          throw new Error("A dashboard folder with this name already exists.");
        if (action === "create") id = randomUUID();
        else if (!Object.hasOwn(store.folders, id))
          throw new Error("This dashboard folder no longer exists.");
        store.folders[id] = name;
      } else if (action === "remove" && Object.hasOwn(store.folders, id)) {
        delete store.folders[id];
        for (const [directory, folder] of Object.entries(store.assignments))
          if (folder === id) delete store.assignments[directory];
      } else throw new Error("Unknown folder action.");
      await store.save();
      return id;
    } catch (error) {
      Object.assign(store, previous);
      throw error;
    }
  }

  async moveToFolder(directory, id) {
    this.requireKnown(directory);
    const store = this.store;
    if (id !== null && !Object.hasOwn(store.folders, id))
      throw new Error("Choose a dashboard folder.");
    const previous = snapshot(store);
    try {
      if (id === null) delete store.assignments[directory];
      else store.assignments[directory] = id;
      await store.save();
    } catch (error) {
      Object.assign(store, previous);
      throw error;
    }
  }
}
