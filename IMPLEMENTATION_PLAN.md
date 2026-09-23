# Editable code blocks for Obsidian Excalidraw

## Goal

Add a focused code-block workflow to the Obsidian Excalidraw plugin without modifying Excalidraw's core element schema.

## Design

1. Add an **Insert code block** command, canvas context-menu action, and **Mod+Shift+C** default hotkey.
2. Insert an empty custom embeddable at the pointer and focus it immediately—no setup modal.
3. Render a live CodeMirror 6 editor inside the element, with language switching for Python, C++, and SystemVerilog.
4. Include line numbers, syntax highlighting, bracket and quote pairing, smart Enter indentation, Tab/Shift-Tab indentation, completion, selection, and undo/redo.
5. Save code and language in the Excalidraw element's `customData` so move, resize, duplicate, undo, and drawing persistence use normal scene behavior.
6. Debounce scene writes while typing to keep interaction smooth.

## Compatibility

- The drawing remains a normal Obsidian Excalidraw Markdown file; code is serialized in the drawing scene.
- No network service or code execution is involved.
- Existing **Paste code block** behavior remains available.
- The editor uses CodeMirror packages bundled into the plugin and does not depend on a CDN.

## Validation

- Build the production plugin bundle.
- Run targeted lint checks on the new and modified TypeScript files.
- Install the built artifacts in an isolated test vault under `test-vault/`.
- Smoke-test hotkey insertion, immediate focus, editing behavior, resizing, language switching, persistence, and highlighting in Obsidian.
