/** Render the editable vector mark at native macOS icon resolution. */
import { app, BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const directory = path.dirname(fileURLToPath(import.meta.url));
app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      width: 1024,
      height: 1024,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { sandbox: true },
    });
    await window.loadFile(path.join(directory, "assets", "mark.svg"));
    const image = await window.webContents.capturePage();
    await writeFile(
      path.join(directory, "assets", "icon.png"),
      image.resize({ width: 1024, height: 1024 }).toPNG(),
    );
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
