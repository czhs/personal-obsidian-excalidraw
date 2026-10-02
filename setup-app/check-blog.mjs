/** Exercise the blog-post dialog against a disposable Jekyll site; the editor is stubbed. */
import { _electron as electron } from "playwright-core";
import electronPath from "electron";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "vault-blog-test-")));
let desktop;
try {
  const site = path.join(root, "site");
  await mkdir(path.join(site, "_posts"), { recursive: true });
  await writeFile(path.join(site, "_config.yml"), "title: Test\n");
  await writeFile(path.join(root, "obsidian.json"), JSON.stringify({ vaults: {} }));
  desktop = await electron.launch({
    executablePath: electronPath,
    args: [directory],
    env: { ...process.env, VAULTS_TEST_ROOT: root },
  });
  await desktop.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, site);
  const page = await desktop.firstWindow();
  await page.click("#new-post");
  await page.waitForSelector("#post-dialog[open]");
  if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });
  await page.fill("#post-name", "My First: Post");
  await page.click("#post-submit");
  assert.match(await page.textContent("#post-error"), /website folder/);
  await page.click("#choose-site");
  await page.waitForFunction(() => document.querySelector("#choose-site").textContent.includes("site"));
  await page.fill("#post-description", "A short test");
  await page.fill("#post-tags", "ai, infra");
  await page.click("#post-submit");
  await page.waitForSelector("#post-dialog", { state: "hidden" });
  const [file] = await readdir(path.join(site, "_posts"));
  assert.match(file, /^\d{4}-\d{2}-\d{2}-my-first-post\.md$/);
  const text = await readFile(path.join(site, "_posts", file), "utf8");
  assert.match(text, /^---\nlayout: post\ntitle: "My First: Post"\ndate: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:00[+-]\d{4}\ndescription: "A short test"\ntags: ai infra\n/);
  assert.match(text, /published: false/);
  assert.match(await page.textContent("#toast"), /opened in test editor/);
  // Same title again must not overwrite.
  await page.click("#new-post");
  await page.fill("#post-name", "My First: Post");
  await page.click("#post-submit");
  assert.match(await page.textContent("#post-error"), /already exists/);
  assert.equal(await readFile(path.join(site, "_posts", file), "utf8"), text);
  // Site choice persists across restarts.
  assert.equal(JSON.parse(await readFile(path.join(root, "settings", "blog.json"), "utf8")).siteDirectory, site);
  console.log("Blog post checks passed.");
} finally {
  await desktop?.close();
  await rm(root, { recursive: true, force: true });
}
