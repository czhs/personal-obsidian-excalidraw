/** Smoke-test the standalone app without installing into any real vault. */
import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
const directory = path.dirname(fileURLToPath(import.meta.url));
const userData = await realpath(await mkdtemp(path.join(os.tmpdir(), "vaults-packaged-")));
const executable =
  process.argv[2] ??
  path.resolve(
    directory,
    `../desktop-dist/Excalidraw Vaults-darwin-${process.arch}/Excalidraw Vaults.app/Contents/MacOS/Excalidraw Vaults`,
  );
let desktop;
try {
  desktop = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${userData}`],
  });
  const page = await desktop.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForFunction(
    () =>
      !document
        .querySelector("#bundle-version")
        .textContent.includes("Loading"),
  );
  assert.equal(await desktop.evaluate(({ app }) => app.isPackaged), true);
  assert.equal(
    await desktop.evaluate(({ app }) => app.getPath("userData")),
    userData,
  );
  assert.equal(await page.title(), "Excalidraw Vaults");
  await page.locator("#new-vault").click();
  await page.locator("#create-dialog").waitFor({ state: "visible" });
  await page.locator("#cancel-create").click();
  if (await page.locator(".vault-card").count()) {
    const card = page.locator(".vault-card").first();
    await card.hover();
    await card.locator(".cover-button").click();
    await page.locator("#cover-dialog").waitFor({ state: "visible" });
    assert.equal(await page.locator(".preset-choice").count(), 6);
    await page.waitForFunction(() => [...document.querySelectorAll(".preset-choice img")].every(image => image.complete && image.naturalWidth > 0));
    await page.locator("#unsplash-tab").click();
    await page.locator("#unsplash-key").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Close cover picker" }).click();
  }
  await page.screenshot({ path: path.join(directory, "packaged-preview.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: standalone packaged app launches, loads bundled plugin, renders gallery, and opens/closes creation form",
  );
} finally {
  if (desktop) await desktop.close();
  await rm(userData, { recursive: true, force: true });
}
