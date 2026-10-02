import type { ExcalidrawImperativeAPI } from "@zsviczian/excalidraw/types/excalidraw/types";
import type { NonDeletedExcalidrawElement } from "@zsviczian/excalidraw/types/element/src/types";
import type { ExcalidrawLib } from "src/types/excalidrawLib";

/**
 * Shows foreground arrows above a live code editor, which otherwise occludes
 * the canvas. Uses native SVG rendering without changing scene data or bindings.
 * Returns a disposer for the view's React effect (including popout teardown).
 */
export function mountCodeBlockArrowOverlay(
  host: HTMLElement,
  blockId: string,
  api: ExcalidrawImperativeAPI,
  lib: typeof ExcalidrawLib,
): () => void {
  // Mount at the element's full bounds, outside the editor's border/padding.
  const container = host.closest<HTMLElement>(".excalidraw__embeddable-container__inner");
  const ownerWindow = host.ownerDocument.defaultView;
  if (!container || !ownerWindow) return () => {};
  const overlay = container.createSvg("svg", {
    cls: "excalidraw-code-block__arrows",
    attr: { "aria-hidden": "true", preserveAspectRatio: "none" },
  });
  const group = overlay.createSvg("g");
  let disposed = false;
  let frame: number | undefined;
  let revision = 0;
  let previousKey = "";

  const render = async () => {
    frame = undefined;
    const scene = api.getSceneElements();
    const blockIndex = scene.findIndex((element) => element.id === blockId);
    const block = scene[blockIndex];
    if (!block) {
      ++revision;
      previousKey = "";
      group.replaceChildren();
      return;
    }
    const blockBounds = lib.getCommonBoundingBox([block]);
    const arrows = scene.slice(blockIndex + 1).filter((element) => {
      if (element.isDeleted || element.type !== "arrow") return false;
      const bounds = lib.getCommonBoundingBox([element]);
      const margin = Math.max(30, element.strokeWidth * 8);
      return bounds.maxX + margin >= blockBounds.minX &&
        bounds.minX - margin <= blockBounds.maxX &&
        bounds.maxY + margin >= blockBounds.minY &&
        bounds.minY - margin <= blockBounds.maxY;
    });
    const arrowIds = new Set(arrows.map((arrow) => arrow.id));
    const annotations = scene.filter((element) => arrowIds.has(element.id) ||
      (element.type === "text" && arrowIds.has(element.containerId)));
    const state = api.getAppState();
    const key = JSON.stringify([
      block.x, block.y, block.width, block.height, block.angle, state.theme,
      annotations.map((element) => [element.id, element.version, element.versionNonce]),
    ]);
    // Pan, zoom, selection, and code typing do not require a fresh SVG export.
    if (key === previousKey) return;
    previousKey = key;
    const currentRevision = ++revision;
    overlay.setAttribute("viewBox", `0 0 ${block.width} ${block.height}`);
    if (!arrows.length) {
      group.replaceChildren();
      return;
    }

    // Restore/export must not rebind partial-scene arrows to missing targets,
    // apply frame clipping, or add clickable links. Only copies are changed.
    const exported = annotations.map<NonDeletedExcalidrawElement>((element) => ({
      ...element,
      frameId: null,
      link: null,
      ...(element.type === "arrow" ? { startBinding: null, endBinding: null } : {}),
    }));
    const bounds = lib.getCommonBoundingBox(exported);
    try {
      const svg = await lib.exportToSvg({
        elements: exported,
        appState: {
          ...state,
          exportBackground: false,
          exportWithDarkMode: state.theme === "dark",
          exportEmbedScene: false,
          exportScale: 1,
        },
        files: null,
        exportPadding: 30,
        exportingFrame: null,
        skipInliningFonts: true,
      });
      if (disposed || currentRevision !== revision) return;
      svg.setAttribute("x", String(bounds.minX - block.x - 30));
      svg.setAttribute("y", String(bounds.minY - block.y - 30));
      // The embeddable parent already applies its rotation and viewport zoom.
      group.setAttribute("transform", `rotate(${block.angle * -180 / Math.PI} ${block.width / 2} ${block.height / 2})`);
      group.replaceChildren(svg);
    } catch (error) {
      if (disposed || currentRevision !== revision) return;
      previousKey = "";
      group.replaceChildren();
      console.error("Failed to render arrows over code block", error);
    }
  };

  const schedule = () => {
    if (frame !== undefined) return;
    frame = ownerWindow.requestAnimationFrame(() => { void render(); });
  };
  const unsubscribe = api.onChange(schedule);
  schedule();
  return () => {
    disposed = true;
    unsubscribe();
    if (frame !== undefined) ownerWindow.cancelAnimationFrame(frame);
    overlay.remove();
  };
}
