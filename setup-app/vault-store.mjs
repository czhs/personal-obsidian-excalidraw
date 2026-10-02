/** Local vault catalog. Reads Obsidian's registry, never drawing contents. */
import { createHash } from "node:crypto";
import {
  readFile,
  writeFile,
  mkdir,
  stat,
  realpath,
  rename,
} from "node:fs/promises";
import path from "node:path";
import { coverInfo } from "./covers.mjs";
import { recoverArchive } from "./archive-recovery.mjs";

const PLUGIN_ID = "obsidian-excalidraw-plugin";
async function bundleHash(directory) {
  const digest = createHash("sha256");
  for (const filename of ["main.js", "styles.css", "manifest.json"])
    digest.update(await readFile(path.join(directory, filename)));
  return digest.digest("hex");
}

export class VaultStore {
  constructor({ registryPath, userData, distDirectory }) {
    this.registryPath = registryPath;
    this.userData = userData;
    this.distDirectory = distDirectory;
    this.paths = new Set();
    this.archived = {};
    this.backups = {};
    this.folders = {};
    this.assignments = {};
    this.covers = {};
    this.reloadPending = {};
    this.warning = "";
  }

  async init() {
    this.manifest = JSON.parse(
      await readFile(path.join(this.distDirectory, "manifest.json"), "utf8"),
    );
    this.bundleHash = await bundleHash(this.distDirectory);
    let migrateArchive = false;
    try {
      const saved = JSON.parse(
        await readFile(path.join(this.userData, "vaults.json"), "utf8"),
      );
      if (
        !Array.isArray(saved.paths) ||
        saved.paths.some(
          (item) => typeof item !== "string" || !path.isAbsolute(item),
        )
      )
        throw new Error("Invalid vault list");
      for (const field of [
        "folders",
        "assignments",
        "covers",
        "reloadPending",
      ]) {
        if (saved[field] !== undefined) {
          if (
            !saved[field] ||
            typeof saved[field] !== "object" ||
            Array.isArray(saved[field]) ||
            Object.values(saved[field]).some(
              (value) => typeof value !== "string",
            )
          )
            throw new Error(`Invalid ${field}`);
          this[field] = saved[field];
        }
      }
      migrateArchive = !Object.hasOwn(saved, "archived");
      if (saved.archived !== undefined) {
        if (
          !saved.archived ||
          typeof saved.archived !== "object" ||
          Array.isArray(saved.archived) ||
          Object.entries(saved.archived).some(
            ([directory, record]) =>
              !path.isAbsolute(directory) ||
              !record ||
              typeof record !== "object" ||
              Array.isArray(record),
          )
        )
          throw new Error("Invalid archive");
        this.archived = saved.archived;
      }
      saved.paths.forEach((item) => this.paths.add(item));
      if (saved.backups && typeof saved.backups === "object")
        this.backups = saved.backups;
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error(
          `Could not read the saved vault gallery: ${error.message}`,
        );
    }
    if (migrateArchive) {
      await recoverArchive(this);
      await this.save();
    }
  }

  async save() {
    await mkdir(this.userData, { recursive: true });
    const filename = path.join(this.userData, "vaults.json");
    await writeFile(
      `${filename}.tmp`,
      JSON.stringify(
        {
          paths: [...this.paths],
          archived: this.archived,
          backups: this.backups,
          folders: this.folders,
          assignments: this.assignments,
          covers: this.covers,
          reloadPending: this.reloadPending,
        },
        null,
        2,
      ),
    );
    await rename(`${filename}.tmp`, filename);
  }

  async normalize(selected) {
    let directory = path.resolve(selected);
    if (path.basename(directory) === ".obsidian")
      directory = path.dirname(directory);
    directory = await realpath(directory);
    if (!(await stat(path.join(directory, ".obsidian"))).isDirectory())
      throw new Error("Choose an Obsidian vault folder containing .obsidian.");
    return directory;
  }

  async add(selected) {
    const directory = await this.normalize(selected);
    if (Object.hasOwn(this.archived, directory))
      throw new Error(
        "This vault is archived. Use Restore in the Archive tab to re-enable it.",
      );
    this.paths.add(directory);
    await this.save();
    return directory;
  }

  async list() {
    this.warning = "";
    try {
      const registry = JSON.parse(await readFile(this.registryPath, "utf8"));
      for (const entry of Object.values(registry.vaults ?? {})) {
        if (typeof entry?.path !== "string" || !path.isAbsolute(entry.path))
          continue;
        let directory = entry.path;
        try {
          directory = await realpath(directory);
        } catch {
          /* Keep missing vaults visible. */
        }
        if (!Object.hasOwn(this.archived, directory)) this.paths.add(directory);
      }
    } catch (error) {
      if (error.code !== "ENOENT")
        this.warning =
          "Obsidian’s vault list could not be read. You can still add a vault manually.";
    }
    const vaults = await Promise.all(
      [...this.paths].map(async (directory) => {
        const info = {
          path: directory,
          folder: this.assignments[directory] ?? null,
          name: path.basename(directory),
          cover: await coverInfo(this, directory),
          reloadPending: this.reloadPending[directory] ?? null,
          status: "standard",
          version: null,
          backup: this.backups[directory] ?? null,
        };
        try {
          if (!(await stat(path.join(directory, ".obsidian"))).isDirectory())
            throw new Error("Missing vault");
        } catch {
          return { ...info, status: "missing" };
        }
        try {
          const plugin = path.join(
            directory,
            ".obsidian",
            "plugins",
            PLUGIN_ID,
          );
          const manifest = JSON.parse(
            await readFile(path.join(plugin, "manifest.json"), "utf8"),
          );
          info.version = manifest.version;
          if (manifest.name === "Excalidraw Codeblocks") {
            info.status =
              (await bundleHash(plugin)) === this.bundleHash
                ? "custom"
                : "update";
          }
        } catch (error) {
          if (error.code !== "ENOENT") info.status = "repair";
        }
        return info;
      }),
    );
    return {
      archived: (
        await Promise.all(
          Object.entries(this.archived).map(async ([directory, record]) => ({
            path: directory,
            name: path.basename(directory),
            cover: await coverInfo(this, directory),
            reloadPending: this.reloadPending[directory] ?? null,
            status: "archived",
            folder: this.assignments[directory] ?? null,
            archivedAt: record.archivedAt,
            recovered: !!record.recovered,
          })),
        )
      ).sort((a, b) => a.name.localeCompare(b.name)),
      vaults: vaults.sort((a, b) => a.name.localeCompare(b.name)),
      folders: Object.entries(this.folders)
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      version: this.manifest.version,
      warning: this.warning,
    };
  }
}
