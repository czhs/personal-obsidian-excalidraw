# Deploying Excalidraw Codeblocks

This fork replaces the standard Excalidraw runtime inside each Obsidian vault. Keep this project as the single source copy; do not edit the generated plugin files separately in every vault.

## Equations

Press **Cmd/Ctrl+Shift+L** inside a drawing to open the visual equation editor. If an equation is selected, the shortcut edits it. Type `/` for fractions and `^` for powers, or choose templates for sums, products, integrals, partial derivatives, gradients, vectors, matrices, expectations, norms, and transposes. **Cmd/Ctrl+Enter** inserts or saves; **Esc** cancels. The **LaTeX** tab accepts pasted source and shows the canvas preview. Default new equations start blank; custom boilerplate is preserved.

MathLive input, fonts, and a cached MathJax SVG renderer are bundled locally. Standard ML equations do not require Excalidraw Extras or any network connection. Existing equations retain their LaTeX source and the standard Excalidraw image format. A configured `preamble.sty` still supplies macros. Advanced syntax outside the bundled packages can use Extras if its MathJax component is already active; no activation prompt blocks the standard workflow. The input remains an equation editor, not a graphing calculator.

## Mac app (recommended)

Open **Excalidraw Vaults.app** on your Desktop. The app includes a copy of your custom plugin; no terminal, Node.js, or internet connection is needed to use the packaged app.

- **New vault**: enter a name and choose a parent folder. A new vault is created with the custom editor installed.
- **Add an existing vault**: choose a vault to add to the gallery. Obsidian’s registered vaults also appear automatically.
- **Upgrade vault**: one click saves open drawings, backs up the previous plugin, installs the bundled custom plugin, and reloads Excalidraw in that open vault. Other vault windows stay open. Closed vaults load the update next time. Enable Obsidian’s **Settings → General → Advanced → Command line interface** once for automatic reload. If the CLI is unavailable or reload fails, the app keeps the installation and shows **Reload editor** with recovery instructions. A drawing-save failure stops the upgrade.
- **Update custom editor**: installs the bundled build when it differs from the custom build already in the vault.
- **Open in Obsidian**: opens a vault. If a newly created vault is not registered yet, use Obsidian’s **Open folder as vault** option. Allow community plugins if prompted.
- **Backup**: shows the previous plugin backup in Finder after an upgrade.
- **Manage vault (⋯)**: rename the vault folder and update its existing Obsidian registry entry, or archive it without deleting drawings, settings, or backups. Archiving removes it from the active dashboard and Obsidian’s vault list. Quit Obsidian before rename/archive/restore so it cannot overwrite registry changes.
- **Change cover** (hover over a card): upload a PNG, JPEG, WebP, or GIF up to 20 MB, choose one of six credited Unsplash presets, or return to default artwork. Uploads are resized and copied into the app’s local `covers/` directory; originals are untouched. Covers survive rename, dashboard folder changes, archive, restore, and app restarts. Presets are bundled for offline use; no vault data or uploaded images are sent to Unsplash. Photographer links open the original photo in your browser.
- **Archive**: shows archived vaults with their original locations and dashboard folder assignments. **Restore vault** re-registers the vault with Obsidian and returns it to the active gallery. If its dashboard folder has since been removed, it returns to **Unfiled**. Missing folders remain archived until their original location is available again. No file contents are moved or rewritten.
- **New blog post**: one click creates `_posts/YYYY-MM-DD-untitled.md` (then `-untitled-2`, …) in your Jekyll site with a blank post header (`layout: post`, current date and time zone, `published: false`) and opens it in Sublime Text with the cursor on the title. Without Sublime Text, it opens in the default text editor. The first click asks for the site folder (containing `_config.yml`); the choice is saved as `blog.json` in the app's user-data directory. Existing posts are never overwritten. Rename the file to match the title before publishing; Jekyll uses the filename for the post URL.
- **Folders (+)**: create dashboard folders, then use a card’s management dialog to move it into a folder. This groups cards without moving files. Folder filters, renaming, and removal are supported; removing a folder returns its vaults to **Unfiled**.

The gallery supports name/path search and filters for custom installations and vaults ready to upgrade. Missing vaults remain visible and can be organized or removed from the list; their file actions are disabled. Gallery artwork is decorative; the app does not read or generate previews from your drawings.

Existing `.excalidraw` and `.excalidraw.md` drawings already use a compatible format. Upgrading their vault makes them available in the custom editor without rewriting the drawings. Other enabled plugins and Excalidraw settings are preserved. Avoid updating this plugin from the official community listing, which would replace the custom runtime.

The old plugin directory and enabled-plugin list are backed up under `.obsidian/codeblocks-backups/`. To restore, quit Obsidian and copy the backed-up directory’s contents into `.obsidian/plugins/obsidian-excalidraw-plugin/`.

## Develop or refresh the app

The desktop UI lives in `setup-app/` and uses plain HTML, CSS, and JavaScript with an isolated Electron preload. It has no runtime npm dependencies beyond Electron. Its catalog is saved in Electron’s user-data directory as `vaults.json`; rename, archive, and restore update Obsidian’s registry while preserving unrelated entries and preferences. On first upgrade from a version without Archive, entries absent from the active vault list are recovered into Archive where possible from this app’s registry snapshots. This recovery does not re-register or change vault files. Original registry snapshots are kept in `registry-backups/` in the app’s user-data directory. Failed changes roll back the folder and registry, and concurrent registry changes are rejected.

From this project, install development dependencies once:

```sh
npm install
npm install --prefix setup-app
node setup-app/node_modules/electron/install.js
```

Run the app from source with `npm run setup:mac`. Build a new standalone app containing the latest custom plugin with:

```sh
npm run setup:package
```

The result is `desktop-dist/Excalidraw Vaults-darwin-<architecture>/Excalidraw Vaults.app`. Quit the previous app before replacing it on your Desktop. The app installs its bundled plugin snapshot, so repackage after changing the plugin source. This is a local personal build, not a notarized public release.

Run `npm run setup:check` for installer and real Electron UI checks against disposable fixture vaults. The editable custom icon is `setup-app/assets/mark.svg`; packaging renders the PNG and macOS ICNS variants.

The earlier `Excalidraw Setup.command` and `scripts/setup-mac.mjs` remain available as the terminal/native-dialog fallback.

## Terminal installation

For an existing folder, run:

```sh
npm run deploy:vault -- "/absolute/path/to/My Vault"
```

This uses the same installer and backup behavior. Reload Excalidraw in an open vault afterward; automatic reload is provided by the Electron dashboard.

## Release through GitHub and BRAT

The repository's release workflow builds and publishes `main.js`, `styles.css`, and `manifest.json` whenever a version tag is pushed. The tag and both manifest files must contain exactly the same version.

```sh
git tag 2.28.0-codeblocks.2
git push origin main
git push origin 2.28.0-codeblocks.2
```

For each release, first update `manifest.json`, `manifest-beta.json`, and `versions.json`, commit those changes, and then create the matching tag. GitHub Actions creates the release that BRAT installs.

Because this is a private repository, configure BRAT with a fine-grained GitHub token limited to this repository and **Contents: read-only** access. Do not install the official Excalidraw plugin beside this fork: both use the same plugin ID and this fork is intended to replace it.

### Unsplash cover browser

**Change cover → Explore Unsplash** opens the integrated photo picker, with topic shortcuts, paginated search, a vault preview, and **Use as cover**. The first use needs an Unsplash developer application Access Key; the picker links to application setup. Enter the Access Key in the app, not in chat. The key is validated, then encrypted by Electron safeStorage on macOS and saved with private file permissions. Disconnect removes the saved key; existing covers remain.

The browser uses the official Unsplash API. Search text and photo requests go to Unsplash; vault names, paths, files, and uploaded covers are never included. Online photo covers are hotlinked from images.unsplash.com with photographer attribution, and selecting a cover triggers Unsplash download tracking. They need an internet connection; the six bundled presets and uploaded images continue to work offline. API request limits depend on the Unsplash application. No shared developer key is bundled.
