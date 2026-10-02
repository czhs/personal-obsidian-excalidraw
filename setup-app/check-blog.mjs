/** Exercise the one-click blog draft button against a disposable Jekyll site; the editor is stubbed. */
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
  const posts = path.join(site, "_posts");
  // First click asks for the site folder (stubbed), then creates and opens a draft.
  await page.click("#new-post");
  await page.waitForFunction(() => /opened in test editor/.test(document.querySelector("#toast").textContent));
  const [file] = await readdir(posts);
  assert.match(file, /^\d{4}-\d{2}-\d{2}-untitled\.md$/);
  const text = await readFile(path.join(posts, file), "utf8");
  assert.match(text, /^---\nlayout: post\ntitle:  # e\.g\. .+\ndate: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:00[+-]\d{4} # .+\ndescription:  # .+\ntags:  # .+\ncategories:  # .+\n/);
  assert.match(text, /published: false/);
  // Second click reuses the saved site and never overwrites the first draft.
  await desktop.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => { throw new Error("site folder should be remembered"); };
  });
  await page.click("#new-post");
  await page.waitForFunction(() => /untitled-2\.md/.test(document.querySelector("#toast").textContent));
  assert.deepEqual((await readdir(posts)).sort(), [file, file.replace("untitled", "untitled-2")].sort());
  assert.equal(await readFile(path.join(posts, file), "utf8"), text);
  assert.equal(JSON.parse(await readFile(path.join(root, "settings", "blog.json"), "utf8")).siteDirectory, site);
  console.log("Blog post checks passed.");
} finally {
  await desktop?.close();
  await rm(root, { recursive: true, force: true });
}
