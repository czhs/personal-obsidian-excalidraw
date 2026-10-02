/** Routes code-block trackpad gestures through the canvas's pan/zoom handling. */
export function mountCodeBlockWheelForwarding(block: HTMLElement): () => void {
  const forwardWheel = (event: WheelEvent): void => {
    const canvas = block.closest(".excalidraw")
      ?.querySelector<HTMLCanvasElement>("canvas.excalidraw__canvas");
    const ownerWindow = block.ownerDocument.defaultView;
    if (!canvas || !ownerWindow) return;

    // Excalidraw only navigates for wheel events targeting a canvas. Capture
    // before CodeMirror scrolls, then reuse that handler (including zoom and
    // input-device preferences) without taking focus away from the editor.
    event.preventDefault();
    event.stopPropagation();
    canvas.dispatchEvent(new ownerWindow.WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: ownerWindow,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      buttons: event.buttons,
    }));
  };

  block.addEventListener("wheel", forwardWheel, { capture: true, passive: false });
  return () => block.removeEventListener("wheel", forwardWheel, true);
}
