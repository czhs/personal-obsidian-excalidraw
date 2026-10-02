/** Trusted desktop boundary: the renderer can only operate on selected/known vaults. */
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  nativeImage,
  safeStorage,
} from "electron";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { VaultManagement, validateName } from "./vault-management.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { realpath } from "node:fs/promises";
import { VaultStore } from "./vault-store.mjs";
import { installCodeblocks } from "../scripts/install-codeblocks.mjs";

import { ObsidianReload } from "./obsidian-reload.mjs";
import {
  presets,
  setCover,
  uploadCover,
  setUnsplashCover,
  coverCredit,
} from "./covers.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const testRoot = !app.isPackaged && process.env.VAULTS_TEST_ROOT;
if (testRoot) app.setPath("userData", path.join(testRoot, "settings"));
app.setName("Excalidraw Vaults");
let window;
let busy = false;
const selectedParents = new Set();
const store = new VaultStore({
  registryPath: testRoot
    ? path.join(testRoot, "obsidian.json")
    : path.join(app.getPath("appData"), "obsidian", "obsidian.json"),
  userData: app.getPath("userData"),
  distDirectory: path.resolve(directory, "../dist"),
});
import { UnsplashLibrary } from "./unsplash.mjs";
import { BlogDrafts } from "./blog.mjs";
const unsplash = new UnsplashLibrary(store.userData, safeStorage);
const blog = new BlogDrafts(
  store.userData,
  testRoot ? { open: async () => "test editor" } : {},
);
const reloader = new ObsidianReload(store.registryPath);
const prepareReload = (destination) =>
  testRoot
    ? Promise.resolve({ status: "closed" })
    : reloader.prepare(destination);
const management = new VaultManagement(store, async () => {
  if (testRoot) return;
  const { stdout } = await promisify(execFile)("/bin/ps", ["-axo", "comm="]);
  if (stdout.split("\n").some((line) => /(?:^|\/)Obsidian$/.test(line.trim())))
    throw new Error(
      "Quit Obsidian before renaming, archiving, or restoring a vault, then try again. This keeps its vault list in sync.",
    );
});

const pageURL = pathToFileURL(path.join(directory, "index.html")).href;

function handle(channel, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (
      event.sender !== window?.webContents ||
      event.senderFrame?.url !== pageURL
    )
      throw new Error("Untrusted request");
    try {
      return { ok: true, value: await action(...args) };
    } catch (error) {
      return {
        ok: false,
        error:
          error.code === "EEXIST"
            ? "A folder with this name already exists. Choose a different vault name."
            : error.message,
      };
    }
  });
}

async function knownVault(selected) {
  if (typeof selected !== "string" || !store.paths.has(selected))
    throw new Error("Select a vault from your gallery first.");
  return store.normalize(selected);
}

function mutation(channel, action) {
  handle(channel, async (...args) => {
    if (busy) throw new Error("Wait for the current operation to finish.");
    busy = true;
    try {
      return await action(...args);
    } finally {
      busy = false;
    }
  });
}
mutation("vaults:rename", (directory, name) =>
  management.renameVault(directory, name),
);
mutation("vaults:restore", (directory) => management.restoreVault(directory));
mutation("vaults:remove", (directory) => management.removeVault(directory));
mutation("vaults:folder", (action, id, name) =>
  management.folder(action, id, name),
);
mutation("vaults:move", (directory, id) =>
  management.moveToFolder(directory, id),
);

handle("vaults:list", () => {
  if (busy) throw new Error("Wait for the current operation to finish.");
  return store.list();
});
handle("vaults:choose", async (kind) => {
  if (busy) throw new Error("Wait for the current installation to finish.");
  if (!["parent", "existing"].includes(kind))
    throw new Error("Unknown folder selection.");
  const result = await dialog.showOpenDialog(window, {
    title:
      kind === "parent"
        ? "Where should your new vault live?"
        : "Add an existing Obsidian vault",
    buttonLabel: kind === "parent" ? "Choose location" : "Add vault",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled) return null;
  if (busy) throw new Error("Wait for the current operation to finish.");
  if (kind === "existing") {
    busy = true;
    try {
      return await store.add(result.filePaths[0]);
    } finally {
      busy = false;
    }
  }
  const selected = await realpath(result.filePaths[0]);
  selectedParents.add(selected);
  return selected;
});
handle("vaults:install", async (request) => {
  if (busy) throw new Error("An installation is already running.");
  busy = true;
  try {
    const create = request?.mode === "create";
    let destination;
    if (create) {
      if (!selectedParents.has(request.parent))
        throw new Error("Choose a location first.");
      const name = validateName(request.name);
      if (
        request.folder != null &&
        !Object.hasOwn(store.folders, request.folder)
      )
        throw new Error("Choose an existing dashboard folder.");
      destination = path.join(request.parent, name);
    } else if (request?.mode === "upgrade") {
      destination = await knownVault(request.path);
    } else throw new Error("Unknown installation action.");
    const session = create
      ? { status: "closed" }
      : await prepareReload(destination);
    await reloader.save(session);
    const result = await installCodeblocks(store.distDirectory, destination, {
      create,
    });
    store.paths.add(result.vaultDirectory);
    if (create && request.folder)
      store.assignments[result.vaultDirectory] = request.folder;
    if (result.backupDirectory)
      store.backups[result.vaultDirectory] = result.backupDirectory;
    const reload = await reloader.finish(session);
    if (reload.status === "pending")
      store.reloadPending[destination] = reload.message;
    else delete store.reloadPending[destination];
    // Installation has succeeded even if saving the gallery fails.
    let warning = "";
    try {
      await store.save();
    } catch {
      warning =
        "Installed successfully, but the gallery could not be saved. Add this vault again next time.";
    }
    return { ...result, warning, reload };
  } finally {
    busy = false;
  }
});
mutation("vaults:reload", async (selected) => {
  const directory = await knownVault(selected);
  const session = await prepareReload(directory);
  await reloader.save(session);
  const result = await reloader.finish(session);
  if (result.status === "pending")
    store.reloadPending[directory] = result.message;
  else delete store.reloadPending[directory];
  await store.save();
  return result;
});
handle("covers:presets", () =>
  presets.map(({ id, title, author }) => ({ id, title, author })),
);
mutation("covers:set", async (selected, preset) => {
  if (!store.paths.has(selected) && !Object.hasOwn(store.archived, selected))
    throw new Error("Choose a vault first.");
  if (preset !== null && !presets.some((item) => item.id === preset))
    throw new Error("Choose a preset from the library.");
  await setCover(store, selected, preset);
});
mutation("covers:upload", async (selected) => {
  if (!store.paths.has(selected) && !Object.hasOwn(store.archived, selected))
    throw new Error("Choose a vault first.");
  const choice = await dialog.showOpenDialog(window, {
    title: "Choose a vault cover",
    buttonLabel: "Use cover",
    properties: ["openFile"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
    ],
  });
  if (choice.canceled) return false;
  await uploadCover(store, selected, choice.filePaths[0], nativeImage);
  return true;
});
handle("covers:credit", async (id) =>
  shell.openExternal(await coverCredit(store, id)),
);
handle("unsplash:status", () => unsplash.status());
mutation("unsplash:connect", (key) => unsplash.connect(key));
mutation("unsplash:disconnect", () => unsplash.disconnect());
handle("unsplash:search", (query, page) => unsplash.search(query, page));
handle("unsplash:setup", () =>
  shell.openExternal("https://unsplash.com/oauth/applications"),
);
handle("unsplash:credit", (id) => shell.openExternal(unsplash.credit(id)));
mutation("unsplash:select", async (selected, id) => {
  if (!store.paths.has(selected) && !Object.hasOwn(store.archived, selected))
    throw new Error("Choose a vault first.");
  await setUnsplashCover(store, selected, await unsplash.select(id));
});
handle("blog:status", () => blog.status());
handle("blog:choose", async () => {
  const result = await dialog.showOpenDialog(window, {
    title: "Choose your website folder",
    message: "Choose the Jekyll site folder that contains _config.yml.",
    buttonLabel: "Use this site",
    properties: ["openDirectory"],
  });
  if (result.canceled) return null;
  return blog.setSite(result.filePaths[0]);
});
handle("blog:create", (request) => blog.create(request));
handle("vaults:open", async (selected) => {
  const directory = await knownVault(selected);
  await shell.openExternal(
    `obsidian://open?path=${encodeURIComponent(directory)}`,
  );
});
handle("vaults:reveal", async (selected) => {
  const directory =
    typeof selected === "string" && Object.hasOwn(store.archived, selected)
      ? await store.normalize(selected)
      : await knownVault(selected);
  shell.showItemInFolder(directory);
});
handle("vaults:backup", async (selected) => {
  await knownVault(selected);
  const backup = store.backups[selected];
  const expectedParent = path.join(selected, ".obsidian", "codeblocks-backups");
  if (typeof backup !== "string" || path.dirname(backup) !== expectedParent)
    throw new Error("No backup is available for this vault.");
  shell.showItemInFolder(backup);
});

function createWindow() {
  window = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 820,
    minHeight: 600,
    title: "Excalidraw Vaults",
    backgroundColor: "#f7f7f4",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 22, y: 23 },
    icon: path.join(directory, "assets", "icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.on("close", (event) => {
    if (busy) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  window.loadFile(path.join(directory, "index.html"));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(async () => {
    try {
      await store.init();
      await blog.init();
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          { role: "editMenu" },
          { role: "windowMenu" },
        ]),
      );
      app.setAboutPanelOptions({
        applicationName: "Excalidraw Vaults",
        applicationVersion: app.getVersion(),
        copyright: "Your drawings. Your tools. Locally.",
      });
      createWindow();
    } catch (error) {
      dialog.showErrorBox("Unable to open Excalidraw Vaults", error.message);
      app.quit();
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on("before-quit", (event) => {
    if (busy) event.preventDefault();
  });
}
