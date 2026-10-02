/** Use Obsidian's registered CLI; never restart the app or open a closed vault. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
const execute = promisify(execFile);
const PLUGIN = "obsidian-excalidraw-plugin";
const HELP =
  "Enable Command line interface in Obsidian Settings → General → Advanced, then select Reload editor.";
export class ObsidianReload {
  constructor(registryPath, run = execute) {
    this.registryPath = registryPath;
    this.run = run;
    this.cli = "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli";
  }
  async command(args) {
    const { stdout, stderr } = await this.run(this.cli, args, {
      cwd: "/",
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    const result = stdout.trim();
    if (
      /^(?:Error:|Command line interface is not enabled|Unable to)/im.test(
        result,
      ) ||
      (!result && stderr?.trim())
    )
      throw new Error(result || stderr.trim());
    return result;
  }
  async prepare(directory) {
    try {
      const { stdout } = await this.run("/bin/ps", ["-axo", "comm="], {
        timeout: 5000,
      });
      const executable = stdout
        .split("\n")
        .map((line) => line.trim())
        .find((line) =>
          /\/Obsidian\.app\/Contents\/MacOS\/Obsidian$/.test(line),
        );
      if (!executable) return { status: "closed" };
      this.cli = path.join(path.dirname(executable), "obsidian-cli");
      const registry = JSON.parse(await readFile(this.registryPath, "utf8"));
      const entries = Object.entries(registry.vaults ?? {});
      const canonical = await realpath(directory);
      const matches = await Promise.all(
        entries.map(async ([id, entry]) => {
          try {
            return (await realpath(entry.path)) === canonical ? id : null;
          } catch {
            return null;
          }
        }),
      );
      const id = matches.find(Boolean);
      // A newly added, unregistered vault cannot be open in Obsidian yet.
      if (!id) return { status: "closed" };
      const targets = JSON.parse(
        await this.command(["dev:cdp", "method=Target.getTargets"]),
      );
      const name = path.basename(directory);
      const isOpen = targets.targetInfos.some(
        (target) =>
          target.type === "page" &&
          target.url.startsWith("app://obsidian.md/") &&
          (target.title.includes(` - ${name} - Obsidian `) ||
            target.title.startsWith(`${name} - Obsidian `)),
      );
      if (!isOpen) return { status: "closed" };
      if (
        entries.filter(
          ([, entry]) =>
            typeof entry.path === "string" &&
            path.basename(entry.path) === name,
        ).length > 1
      )
        return {
          status: "pending",
          message:
            "More than one vault has this name. Reload Excalidraw in this vault’s Community plugins settings.",
        };
      return { status: "open", id, directory: canonical };
    } catch {
      return {
        status: "pending",
        message: `The editor could not be reached. ${HELP}`,
      };
    }
  }
  async save(session) {
    if (session.status !== "open") return;
    const code = `(async()=>{if(app.vault.adapter.getBasePath()!==${JSON.stringify(session.directory)})throw new Error("Vault changed; retry the upgrade");for(const leaf of app.workspace.getLeavesOfType("excalidraw")){await leaf.view.save(true,true);}return "vault-drawings-saved";})()`;
    const output = await this.command([
      `vault=${session.id}`,
      "eval",
      `code=${code}`,
    ]);
    if (!output.includes("vault-drawings-saved"))
      throw new Error(
        "Could not save the open drawings. Save them in Obsidian, then retry the upgrade.",
      );
  }
  async finish(session) {
    if (session.status !== "open") return session;
    try {
      const output = await this.command([
        `vault=${session.id}`,
        "plugin:reload",
        `id=${PLUGIN}`,
      ]);
      if (!output.includes(`Reloaded: ${PLUGIN}`))
        throw new Error("Reload was not confirmed");
      // Plugin startup continues after the CLI's reload acknowledgement.
      const readyCode = `(async()=>{if(app.vault.adapter.getBasePath()!==${JSON.stringify(session.directory)})throw new Error("Vault changed");for(let attempt=0;attempt<80;attempt++){if(app.commands.commands["${PLUGIN}:insert-codeblock"])return "vault-editor-ready";await new Promise(resolve=>setTimeout(resolve,250));}throw new Error("Editor is still loading");})()`;
      const ready = await this.command([
        `vault=${session.id}`,
        "eval",
        `code=${readyCode}`,
      ]);
      if (!ready.includes("vault-editor-ready"))
        throw new Error("Editor command unavailable");
      return { status: "reloaded" };
    } catch {
      return {
        status: "pending",
        message:
          "Installed successfully, but the editor could not reload. Select Reload editor to try again, or toggle Excalidraw off and on in this vault’s Community plugins settings.",
      };
    }
  }
}
