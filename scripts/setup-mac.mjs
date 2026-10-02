/** Native macOS folder navigator for personal vault creation and upgrades. */
import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installCodeblocks } from "./install-codeblocks.mjs";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function dialog(source, ...args) {
  return execFileSync("/usr/bin/osascript", ["-e", source, "--", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
try {
  if (process.platform !== "darwin") throw new Error("This setup tool requires macOS.");
  const choice = dialog('choose from list {"Create new vault", "Upgrade existing vault"} with title "Excalidraw Codeblocks" with prompt "Create a vault or use the custom editor for an existing vault’s drawings."');
  if (choice === "false") process.exit(0);
  const create = choice === "Create new vault";
  let destination;
  if (create) {
    const parent = dialog('POSIX path of (choose folder with prompt "Choose where to create your new vault")');
    const name = dialog('text returned of (display dialog "New vault name:" default answer "My Excalidraw Vault" with title "Excalidraw Codeblocks")');
    if (!name || name === "." || name === ".." || /[/:\x00-\x1f]/.test(name)) throw new Error("Use a vault name without slashes, colons, or control characters.");
    destination = path.join(parent, name);
  } else {
    destination = dialog('POSIX path of (choose folder with prompt "Choose an existing Obsidian vault to upgrade")');
    if (path.basename(path.resolve(destination)) === ".obsidian") destination = path.dirname(path.resolve(destination));
    if (!(await stat(path.join(destination, ".obsidian"))).isDirectory()) throw new Error("This folder is not an Obsidian vault. Select a folder containing .obsidian.");
    dialog('display dialog "Quit Obsidian before continuing. The installed plugin will be backed up and replaced. Your drawings and settings will be preserved." buttons {"Cancel", "Continue"} default button "Continue" cancel button "Cancel" with title "Upgrade vault"');
  }
  console.log("Building your custom Excalidraw plugin...");
  execFileSync("npm", ["run", "build"], { cwd: projectDirectory, stdio: "inherit" });
  const result = await installCodeblocks(path.join(projectDirectory, "dist"), destination, { create });
  const message = `Ready: ${result.vaultDirectory}\n\nExisting drawings work in the custom editor without conversion. In Obsidian, allow community plugins if prompted.${result.backupDirectory ? `\n\nPlugin backup: ${result.backupDirectory}` : ""}`;
  console.log(message);
  const open = dialog('on run argv\nreturn button returned of (display dialog (item 1 of argv) buttons {"Done", "Open vault"} default button "Open vault" with title "Excalidraw Codeblocks")\nend run', message);
  if (open === "Open vault") execFileSync("/usr/bin/open", [`obsidian://open?path=${encodeURIComponent(result.vaultDirectory)}`]);
} catch (error) {
  if (String(error.stderr).includes("(-128)")) process.exit(0);
  console.error(error.message);
  if (process.platform === "darwin") dialog('on run argv\ndisplay dialog (item 1 of argv) buttons {"OK"} default button "OK" with title "Setup failed"\nend run', error.message);
  process.exitCode = 1;
}
