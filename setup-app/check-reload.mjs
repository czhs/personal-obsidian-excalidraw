/** Check reload scope, ordering, closed vault handling, and failure recovery. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ObsidianReload } from "./obsidian-reload.mjs";
const root = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "vault-reload-")),
);
try {
  const directory = path.join(root, "My vault");
  await mkdir(directory);
  const registry = path.join(root, "obsidian.json");
  await writeFile(
    registry,
    JSON.stringify({ vaults: { known: { path: directory } } }),
  );
  let running = true,
    open = true,
    disabled = false,
    failSave = false,
    failReload = false;
  let title = "Drawing - My vault - Obsidian 1.13.7";
  const calls = [];
  const reload = new ObsidianReload(registry, async (file, args, options) => {
    calls.push({ file, args });
    if (file === "/bin/ps")
      return {
        stdout: running
          ? "/Applications/Obsidian.app/Contents/MacOS/Obsidian\n"
          : "",
      };
    assert.equal(options.cwd, "/");
    if (disabled) return { stdout: "Command line interface is not enabled." };
    if (args[0] === "dev:cdp")
      return {
        stdout: JSON.stringify({
          targetInfos: open
            ? [
                {
                  type: "page",
                  url: "app://obsidian.md/index.html",
                  title,
                },
              ]
            : [],
        }),
      };
    assert.equal(args[0], "vault=known");
    if (args[1] === "eval" && args[2].includes("vault-editor-ready"))
      return { stdout: "=> vault-editor-ready" };
    if (args[1] === "eval")
      return {
        stdout: failSave ? "Error: disk full" : "=> vault-drawings-saved",
      };
    if (args[1] === "plugin:reload")
      return {
        stdout: failReload
          ? "Error: plugin failed"
          : "Reloaded: obsidian-excalidraw-plugin",
      };
    if (args[1] === "hotkey") return { stdout: "⌘ ⇧ C" };
    throw new Error("Unexpected command");
  });
  const session = await reload.prepare(directory);
  assert.equal(session.status, "open");
  await reload.save(session);
  assert.deepEqual(await reload.finish(session), { status: "reloaded" });
  assert(
    calls
      .find((c) => c.args[1] === "eval")
      .args[2].includes(JSON.stringify(directory)),
  );
  assert(
    calls.findIndex((c) => c.args[1] === "eval") <
      calls.findIndex((c) => c.args[1] === "plugin:reload"),
  );
  title = "My vault - Obsidian 1.13.7";
  assert.equal((await reload.prepare(directory)).status, "open");
  failSave = true;
  await assert.rejects(() => reload.save(session), /disk full/);
  failSave = false;
  failReload = true;
  assert.equal((await reload.finish(session)).status, "pending");
  failReload = false;
  disabled = true;
  assert.equal((await reload.prepare(directory)).status, "pending");
  disabled = false;
  open = false;
  assert.equal((await reload.prepare(directory)).status, "closed");
  running = false;
  const before = calls.length;
  assert.equal((await reload.prepare(directory)).status, "closed");
  assert.equal(calls.length, before + 1);
  running = true;
  open = true;
  const other = path.join(root, "other/My vault");
  await mkdir(other, { recursive: true });
  await writeFile(
    registry,
    JSON.stringify({
      vaults: { known: { path: directory }, other: { path: other } },
    }),
  );
  assert.equal((await reload.prepare(directory)).status, "pending");
  assert(
    !calls.some(
      (c) =>
        c.args.includes("restart") ||
        c.args.includes("reload") ||
        c.args.includes("open"),
    ),
  );
  console.log(
    "PASS: targeted reload, save first, CLI disabled, closed vault, save failure, reload failure, ambiguous vault names, no app restart",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
