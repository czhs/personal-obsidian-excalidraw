/** Exercise the real Electron UI with isolated vault fixtures and native dialog stubs. */
import { _electron as electron } from "playwright-core";
import electronPath from "electron";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  cp,
  rm,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "vault-gallery-test-")),
);
let desktop;
try {
  const vault = path.join(root, "Design notebook");
  const custom = path.join(root, "Code & sketches");
  const third = path.join(root, "Weekend ideas");
  for (const folder of [vault, custom, third])
    await mkdir(
      path.join(folder, ".obsidian/plugins/obsidian-excalidraw-plugin"),
      { recursive: true },
    );
  const plugin = path.join(
    vault,
    ".obsidian/plugins/obsidian-excalidraw-plugin",
  );
  await writeFile(
    path.join(plugin, "manifest.json"),
    JSON.stringify({
      id: "obsidian-excalidraw-plugin",
      name: "Excalidraw",
      version: "old",
    }),
  );
  await writeFile(path.join(plugin, "main.js"), "old runtime");
  await writeFile(path.join(plugin, "data.json"), '{"keep":true}');
  await writeFile(
    path.join(vault, "Drawing.excalidraw.md"),
    "original drawing",
  );
  await cp(
    path.resolve(directory, "../dist"),
    path.join(custom, ".obsidian/plugins/obsidian-excalidraw-plugin"),
    { recursive: true },
  );
  await writeFile(
    path.join(root, "obsidian.json"),
    JSON.stringify({
      vaults: {
        one: { path: vault },
        two: { path: custom },
        three: { path: third },
      },
    }),
  );
  desktop = await electron.launch({
    executablePath: electronPath,
    args: [directory],
    env: { ...process.env, VAULTS_TEST_ROOT: root },
  });
  const page = await desktop.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator(".vault-card").first().waitFor();
  assert.equal(await page.locator(".vault-card").count(), 3);
  await page.screenshot({ path: path.join(directory, "gallery-preview.png") });
  const coverCard = page.locator(".vault-card", { hasText: "Design notebook" });
  await coverCard.hover();
  await coverCard.locator(".cover-button").click();
  await page.locator("#cover-dialog").waitFor({ state: "visible" });
  assert.equal(await page.locator(".preset-choice").count(), 6);
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".preset-choice img")].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  await page.screenshot({ path: path.join(directory, "covers-preview.png") });
  await page
    .getByRole("button", { name: "Use Alpine lake cover", exact: true })
    .click();
  await page.locator("#cover-dialog").waitFor({ state: "hidden" });
  assert.match(
    await coverCard.locator(".cover-credit").textContent(),
    /Luca Bravo/,
  );
  const upload = path.join(root, "my-cover.png");
  await cp(path.join(directory, "assets/icon.png"), upload);
  await desktop.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
  }, upload);
  await coverCard.hover();
  await coverCard.locator(".cover-button").click();
  await page.locator("#upload-cover").click();
  await page.locator("#cover-dialog").waitFor({ state: "hidden" });
  await rm(upload);
  await page.locator("#refresh").click();
  await page.waitForFunction(
    () => document.querySelector(".has-cover img")?.naturalWidth > 0,
  );
  const savedCover = JSON.parse(
    await readFile(path.join(root, "settings/vaults.json"), "utf8"),
  ).covers[vault];
  assert.match(savedCover, /\.jpg$/);
  assert(
    (await readFile(path.join(root, "settings/covers", savedCover))).length > 0,
  );
  await desktop.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await coverCard.hover();
  await coverCard.locator(".cover-button").click();
  await page.locator("#upload-cover").click();
  await page.waitForFunction(
    () => !document.querySelector("#upload-cover").disabled,
  );
  assert(await page.locator("#cover-dialog").isVisible());
  await page.locator("#remove-cover").click();
  await page.locator("#cover-dialog").waitFor({ state: "hidden" });
  await assert.rejects(
    () => readFile(path.join(root, "settings/covers", savedCover)),
    /ENOENT/,
  );
  assert.equal(await coverCard.locator(".has-cover").count(), 0);
  await coverCard.hover();
  await coverCard.locator(".cover-button").click();
  await page
    .getByRole("button", { name: "Use Alpine lake cover", exact: true })
    .click();
  await page.locator("#cover-dialog").waitFor({ state: "hidden" });
  const badCover = await page.evaluate(async () => {
    try {
      await window.vaults.cover("/tmp/unknown-vault", "alpine");
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(badCover, true);
  await page.locator("#search").fill("notebook");
  assert.equal(await page.locator(".vault-card").count(), 1);
  await page.locator("#search").fill("");
  await page.locator('[data-filter="custom"]').click();
  assert.equal(await page.locator(".vault-card").count(), 1);
  await page.locator('[data-filter="all"]').click();
  await desktop.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => {
      throw new Error("Upgrade must not request confirmation");
    };
  });
  const oldCard = page.locator(".vault-card", { hasText: "Design notebook" });
  await oldCard.locator(".card-action").click();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".vault-card")]
        .find((card) => card.textContent.includes("Design notebook"))
        ?.querySelector(".badge").textContent === "Custom editor",
  );
  assert.equal(
    await readFile(path.join(plugin, "data.json"), "utf8"),
    '{"keep":true}',
  );
  assert.equal(
    await readFile(path.join(vault, "Drawing.excalidraw.md"), "utf8"),
    "original drawing",
  );
  const state = JSON.parse(
    await readFile(path.join(root, "settings/vaults.json"), "utf8"),
  );
  assert.equal(
    await readFile(path.join(state.backups[vault], "main.js"), "utf8"),
    "old runtime",
  );
  await desktop.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
  }, root);
  await page.locator("#new-vault").click();
  await page.locator("#vault-name").fill("Fresh ideas");
  await page.locator("#create-submit").click();
  assert.match(await page.locator("#form-error").textContent(), /location/);
  await page.locator("#choose-parent").click();
  await page.screenshot({ path: path.join(directory, "create-preview.png") });
  await page.locator("#create-submit").click();
  await page.locator("#create-dialog").waitFor({ state: "hidden" });
  assert.equal(
    JSON.parse(
      await readFile(
        path.join(
          root,
          "Fresh ideas/.obsidian/plugins/obsidian-excalidraw-plugin/manifest.json",
        ),
        "utf8",
      ),
    ).name,
    "Excalidraw Codeblocks",
  );
  await page.locator("#new-vault").click();
  await page.locator("#vault-name").fill("Fresh ideas");
  await page.locator("#create-submit").click();
  await page.waitForFunction(
    () => document.querySelector("#form-error").textContent.length > 0,
  );
  assert.match(
    await page.locator("#form-error").textContent(),
    /already exists/,
  );
  await page.locator("#cancel-create").click();
  const security = await desktop.evaluate(({ BrowserWindow }) => {
    const preferences =
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      sandbox: preferences.sandbox,
      isolation: preferences.contextIsolation,
      node: preferences.nodeIntegration,
    };
  });
  assert.deepEqual(security, { sandbox: true, isolation: true, node: false });
  const rejected = await page.evaluate(async () => {
    try {
      await window.vaults.install({
        mode: "upgrade",
        path: "/tmp/unknown-vault",
      });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(rejected, true);
  await page.locator("#search").fill("no matching vault exists");
  assert.equal(await page.locator(".vault-card").count(), 0);
  assert.match(
    await page.locator(".empty").textContent(),
    /No matching vaults/,
  );
  await page.locator("#search").fill("");
  await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(820, 650),
  );
  await page.screenshot({ path: path.join(directory, "compact-preview.png") });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await desktop.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await page.locator("#add-existing").click();
  assert.equal(await page.locator(".vault-card").count(), 4);
  await desktop.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [selected],
    });
  }, vault);
  await page.locator("#add-existing").click();
  assert.equal(await page.locator(".vault-card").count(), 4);

  await page.locator("#new-folder").click();
  await page.locator("#folder-name").fill("Projects");
  await page.locator("#save-folder").click();
  await page.locator("#folder-dialog").waitFor({ state: "hidden" });
  assert.equal(await page.locator("#section-title").textContent(), "Projects");
  await page.locator('[data-filter="all"]').click();
  await page
    .getByRole("button", { name: "Manage Design notebook", exact: true })
    .click();
  await page.locator("#folder-select").selectOption({ label: "Projects" });
  await page.locator("#move-form button").click();
  await page.locator("#manage-dialog").waitFor({ state: "hidden" });
  await page.locator(".folder-filter", { hasText: "Projects" }).click();
  assert.equal(await page.locator(".vault-card").count(), 1);
  await page
    .getByRole("button", { name: "Manage Design notebook", exact: true })
    .click();
  await page.locator("#rename-name").fill("Weekend ideas");
  await page.locator("#rename-submit").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#manage-error")
      .textContent.includes("already exists"),
  );
  await page.locator("#rename-name").fill("Design studio");
  await page.locator("#rename-submit").click();
  await page.locator("#manage-dialog").waitFor({ state: "hidden" });
  const renamed = path.join(root, "Design studio");
  assert.equal(
    JSON.parse(await readFile(path.join(root, "obsidian.json"), "utf8")).vaults
      .one.path,
    renamed,
  );
  assert.equal(
    await readFile(path.join(renamed, "Drawing.excalidraw.md"), "utf8"),
    "original drawing",
  );
  assert.equal(await page.locator(".card-name").textContent(), "Design studio");
  assert.match(await page.locator(".cover-credit").textContent(), /Luca Bravo/);
  await page
    .getByRole("button", { name: "Manage Design studio", exact: true })
    .click();
  await page.locator("#show-remove").click();
  await page.screenshot({
    path: path.join(directory, "management-preview.png"),
  });
  await page.getByRole("button", { name: "Close vault settings" }).click();
  assert.equal(await page.locator(".vault-card").count(), 1);
  await page
    .getByRole("button", { name: "Manage Design studio", exact: true })
    .click();
  await page.locator("#show-remove").click();
  await page.locator("#confirm-remove").click();
  await page.locator("#manage-dialog").waitFor({ state: "hidden" });
  await page.locator("#refresh").click();
  assert.equal(await page.locator(".vault-card").count(), 0);
  assert.equal(
    await readFile(path.join(renamed, "Drawing.excalidraw.md"), "utf8"),
    "original drawing",
  );
  assert.equal(
    JSON.parse(await readFile(path.join(root, "obsidian.json"), "utf8")).vaults
      .one,
    undefined,
  );
  await page.locator('[data-filter="archive"]').click();
  assert.equal(await page.locator(".vault-card").count(), 1);
  assert.equal(await page.locator(".card-name").textContent(), "Design studio");
  assert.match(await page.locator(".cover-credit").textContent(), /Luca Bravo/);
  assert.match(await page.locator(".card-folder").textContent(), /Projects/);
  await page.screenshot({ path: path.join(directory, "archive-preview.png") });
  await page
    .getByRole("button", { name: "Restore vault ↗", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector("#archive-count").textContent === "0",
  );
  assert.equal(
    JSON.parse(await readFile(path.join(root, "obsidian.json"), "utf8")).vaults
      .one.path,
    renamed,
  );
  await page.locator(".folder-filter", { hasText: "Projects" }).click();
  assert.equal(await page.locator(".vault-card").count(), 1);
  assert.equal(await page.locator(".card-name").textContent(), "Design studio");
  assert.match(await page.locator(".cover-credit").textContent(), /Luca Bravo/);
  await page
    .getByRole("button", { name: "Edit folder Projects", exact: true })
    .click();
  await page.locator("#folder-name").fill("Work");
  await page.locator("#save-folder").click();
  await page.locator("#folder-dialog").waitFor({ state: "hidden" });
  await page
    .getByRole("button", { name: "Edit folder Work", exact: true })
    .click();
  await page.locator("#remove-folder").click();
  await page.locator("#folder-dialog").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".folder-row").count(), 0);
  await page.locator('[data-filter="all"]').click();
  await page.locator(".vault-card").first().hover();
  await page.locator(".cover-button").first().click();
  await page.locator("#unsplash-tab").click();
  await page.locator("#unsplash-key").waitFor({ state: "visible" });
  assert.equal(await page.locator("#photo-search").isVisible(), false);
  // Simulate only the API boundary; exercise the actual renderer and IPC bridge.
  await desktop.evaluate(({ ipcMain }) => {
    for (const name of ["connect", "search", "select", "disconnect"]) ipcMain.removeHandler(`unsplash:${name}`);
    globalThis.unsplashSelections = [];
    ipcMain.handle("unsplash:connect", () => ({ ok: true }));
    ipcMain.handle("unsplash:disconnect", () => ({ ok: true }));
    ipcMain.handle("unsplash:search", (_event, query, page) => ({ ok: true, value: {
      photos: query === "nothing" ? [] : Array.from({ length: 12 }, (_, index) => ({
        id: `${page}-${index}`, title: `${query} photo ${index}`, author: "Test photographer",
        thumb: `assets/covers/${["ocean", "alpine", "fern", "dunes", "stars", "mountains"][index % 6]}.jpg`,
        src: "assets/covers/mountains.jpg", creditURL: "https://unsplash.com/@test",
      })), hasMore: query !== "nothing" && page === 1,
    } }));
    ipcMain.handle("unsplash:select", (_event, vault, id) => { globalThis.unsplashSelections.push({ vault, id }); return { ok: true }; });
  });
  await page.locator("#unsplash-key").fill("fixture-access-key");
  await page.locator("#unsplash-key-form button").click();
  await page.waitForFunction(() => document.querySelectorAll(".photo-choice").length === 12);
  assert.equal(await page.locator("#unsplash-key").inputValue(), "");
  await page.locator('[data-topic="architecture"]').click();
  await page.waitForFunction(() => document.querySelector("#photo-status").textContent.includes("architecture"));
  await page.locator("#photo-more").click();
  await page.waitForFunction(() => document.querySelectorAll(".photo-choice").length === 24);
  await page.locator(".photo-choice").first().click();
  await page.locator("#photo-preview").waitFor({ state: "visible" });
  await page.screenshot({ path: path.join(directory, "unsplash-preview.png") });
  await page.locator("#photo-use").click();
  await page.locator("#cover-dialog").waitFor({ state: "hidden" });
  assert.equal(await desktop.evaluate(() => globalThis.unsplashSelections.length), 1);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: gallery, search, filters, one-click upgrade, rename, archive/restore, dashboard folders, backup, preservation, create, validation, collision refusal, IPC path restriction, renderer isolation",
  );
} finally {
  if (desktop) await desktop.close();
  await rm(root, { recursive: true, force: true });
}
