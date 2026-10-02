/** A private iframe gives MathLive its own DOM, fonts, and custom-element registry in every Obsidian window. */
import type { MathfieldElement } from "mathlive";
import { setStyle } from "src/utils/styleUtils";
declare const unpackMathInput: () => string;
declare const evaluateRuntimeInstructions: (
  win: Window,
  source: string,
) => unknown;
declare const bundledMathFonts: Array<{
  family: string;
  style: string;
  weight: string;
  data: string;
}>;
let source: string | undefined;
export async function createVisualMathField(
  frame: HTMLIFrameElement,
): Promise<MathfieldElement> {
  await new Promise<void>((resolve) => {
    frame.onload = () => resolve();
    // Static CSS is intrinsic to this isolated iframe; it cannot inherit the plugin stylesheet.
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-eval'"><style>html,body{margin:0;padding:0;background:transparent}body{padding:14px;box-sizing:border-box}math-field{display:block;min-height:100px;font-size:26px;border:0;outline:none;background:transparent;color:inherit;--contains-highlight-background-color:transparent}math-field::part(virtual-keyboard-toggle),math-field::part(menu-toggle){display:none}</style></head><body></body></html>`;
  });
  const win = frame.contentWindow as Window & { FontFace: typeof FontFace };
  if (!win || !frame.isConnected) throw new Error("Equation editor closed.");
  source ??= unpackMathInput();
  const Mathfield = evaluateRuntimeInstructions(
    win,
    `(function(){${source};return ExcalidrawMathInput.MathfieldElement;})()\n//# sourceURL=app://obsidian.md/excalidraw-math-input.js`,
  ) as typeof MathfieldElement;
  Mathfield.fontsDirectory = null;
  Mathfield.soundsDirectory = null;
  await Promise.all(
    bundledMathFonts.map(async (font) => {
      const face = new win.FontFace(
        font.family,
        `url(data:font/woff2;base64,${font.data})`,
        { style: font.style, weight: font.weight },
      );
      win.document.fonts.add(face);
      await face.load();
    }),
  );
  if (!frame.isConnected) throw new Error("Equation editor closed.");
  setStyle(win.document.body, {
    color: frame.ownerDocument.defaultView.getComputedStyle(frame).color,
  });
  const field = new Mathfield();
  field.mathVirtualKeyboardPolicy = "manual";

  field.popoverPolicy = "off";
  field.setAttribute("aria-label", frame.title);
  win.document.body.append(field);
  field.menuItems = [];
  return field;
}
