# Deploying Excalidraw Codeblocks

This fork replaces the standard Excalidraw runtime inside each Obsidian vault. Keep this project as the single source copy; do not edit the generated plugin files separately in every vault.

## Install into a new vault

Open a terminal in this project and run:

```sh
npm run deploy:vault -- "/absolute/path/to/My Vault"
```

The command:

1. builds the current production bundle;
2. installs `main.js`, `styles.css`, and `manifest.json` under the vault's `.obsidian/plugins/obsidian-excalidraw-plugin/` directory;
3. adds `obsidian-excalidraw-plugin` to `community-plugins.json` if necessary;
4. preserves the vault's existing Excalidraw `data.json` settings and all other enabled plugins.

If the vault is open, run **Reload app without saving** from Obsidian's command palette after deployment.

## Updating every vault

Run the same command once for each vault. Each run builds from this maintained source tree and replaces only the three Excalidraw runtime files.

## Release through GitHub and BRAT

The repository's release workflow builds and publishes `main.js`, `styles.css`, and `manifest.json` whenever a version tag is pushed. The tag and both manifest files must contain exactly the same version.

```sh
git tag 2.28.0-codeblocks.2
git push origin main
git push origin 2.28.0-codeblocks.2
```

For each release, first update `manifest.json`, `manifest-beta.json`, and `versions.json`, commit those changes, and then create the matching tag. GitHub Actions creates the release that BRAT installs.

Because this is a private repository, configure BRAT with a fine-grained GitHub token limited to this repository and **Contents: read-only** access. Do not install the official Excalidraw plugin beside this fork: both use the same plugin ID and this fork is intended to replace it.
