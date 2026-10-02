import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installCodeblocks } from "./install-codeblocks.mjs";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const suppliedPath = process.argv[2];
  if (!suppliedPath) throw new Error('Provide a vault path: npm run deploy:vault -- "/path/to/My Vault"');
  console.log("Building the production plugin bundle...");
  execFileSync("npm", ["run", "build"], { cwd: projectDirectory, stdio: "inherit" });
  const result = await installCodeblocks(path.join(projectDirectory, "dist"), suppliedPath);
  console.log(`Installed Excalidraw Codeblocks into ${result.pluginDirectory}`);
  if (result.backupDirectory) console.log(`Previous plugin backed up to ${result.backupDirectory}`);
  console.log("Existing drawings and settings were preserved. Restart Obsidian to load the custom editor.");
} catch (error) {
  console.error(`Excalidraw Codeblocks deployment failed: ${error.message}`);
  process.exitCode = 1;
}
