/** Lazy access to the offline renderer embedded by Rollup. No network or Extras activation. */
export interface LocalMathSVG {
  svg: string;
  width: number;
  height: number;
}
interface LocalMathRenderer {
  render(source: string, scale?: number, preamble?: string): LocalMathSVG;
  clear(): void;
}
declare const unpackMathRenderer: () => string;
declare const evaluateRuntimeInstructions: (
  win: Window,
  source: string,
) => unknown;
let renderer: LocalMathRenderer | undefined;
export function localMathRenderer(): LocalMathRenderer {
  renderer ??= evaluateRuntimeInstructions(
    window,
    `(function(){${unpackMathRenderer()};return ExcalidrawMathRenderer;})()`,
  ) as LocalMathRenderer;
  return renderer;
}
