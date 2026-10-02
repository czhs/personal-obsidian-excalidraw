/** Package only the small desktop shell and the three built plugin files. */
import { packager } from "@electron/packager";
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const directory = path.dirname(fileURLToPath(import.meta.url));
const project = path.dirname(directory);
if (process.platform !== "darwin")
  throw new Error("Package this app on macOS.");
const metadata = JSON.parse(
  await readFile(path.join(directory, "package.json"), "utf8"),
);
execFileSync(electron, [path.join(directory, "render-icon.mjs")], {
  stdio: "inherit",
});
const staging = await mkdtemp(path.join(os.tmpdir(), "excalidraw-vaults-"));
try {
  const iconset = path.join(staging, "Vaults.iconset");
  await mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      execFileSync(
        "/usr/bin/sips",
        [
          "-z",
          String(size * scale),
          String(size * scale),
          path.join(directory, "assets/icon.png"),
          "--out",
          path.join(
            iconset,
            `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`,
          ),
        ],
        { stdio: "ignore" },
      );
    }
  }
  execFileSync("/usr/bin/iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    path.join(directory, "assets/icon.icns"),
  ]);
  const source = path.join(staging, "app");
  await mkdir(path.join(source, "setup-app"), { recursive: true });
  await mkdir(path.join(source, "scripts"));
  await mkdir(path.join(source, "dist"));
  for (const file of [
    "main.mjs",
    "covers.mjs",
    "unsplash.mjs",
    "blog.mjs",
    "cover-browser.js",
    "obsidian-reload.mjs",
    "vault-store.mjs",
    "vault-management.mjs",
    "vault-registry.mjs",
    "archive-recovery.mjs",
    "preload.cjs",
    "renderer.js",
    "index.html",
    "styles.css",
    "assets",
  ])
    await cp(path.join(directory, file), path.join(source, "setup-app", file), {
      recursive: true,
    });
  await cp(
    path.join(project, "scripts/install-codeblocks.mjs"),
    path.join(source, "scripts/install-codeblocks.mjs"),
  );
  for (const file of ["main.js", "styles.css", "manifest.json"])
    await cp(path.join(project, "dist", file), path.join(source, "dist", file));
  await writeFile(
    path.join(source, "package.json"),
    JSON.stringify(
      {
        name: metadata.name,
        productName: metadata.productName,
        version: metadata.version,
        description: metadata.description,
        type: "module",
        main: "setup-app/main.mjs",
        author: "Personal tools",
        license: "MIT",
      },
      null,
      2,
    ),
  );
  const outputs = await packager({
    dir: source,
    out: path.join(project, "desktop-dist"),
    name: metadata.productName,
    platform: "darwin",
    arch: process.arch,
    electronVersion: metadata.devDependencies.electron,
    electronZipDir: undefined,
    icon: path.join(directory, "assets/icon.icns"),
    appBundleId: "personal.excalidraw.vaults",
    appCategoryType: "public.app-category.productivity",
    overwrite: true,
    asar: true,
    prune: false,
  });
  console.log(`Packaged app: ${outputs.join("\n")}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
