/** Offline, self-contained SVGs. This renderer never loads remote extensions or fonts. */
import { mathjax } from "mathjax-full/js/mathjax.js";
import { TeX } from "mathjax-full/js/input/tex.js";
import { SVG } from "mathjax-full/js/output/svg.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import "mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js";
import "mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "mathjax-full/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "mathjax-full/js/input/tex/color/ColorConfiguration.js";
import "mathjax-full/js/input/tex/cancel/CancelConfiguration.js";
import "mathjax-full/js/input/tex/braket/BraketConfiguration.js";
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const cache = new Map();
export function clear() { cache.clear(); }
export function render(source, scale = 4, preamble = "") {
  const tex = source.trim().replace(/^\$\$([\s\S]*)\$\$$/, "$1").replace(/^\\\[([\s\S]*)\\\]$/, "$1");
  if (!tex) throw new Error("Enter an equation first.");
  if (tex.length + preamble.length > 20000) throw new Error("This equation is too long.");
  if (!Number.isFinite(scale) || scale <= 0 || scale > 100) throw new Error("Invalid equation scale.");
  const key = JSON.stringify([tex, scale, preamble]);
  if (cache.has(key)) return cache.get(key);
  // Fresh parsing state keeps macros and errors in one equation from leaking into another.
  const input = new TeX({ packages: ["base", "ams", "newcommand", "boldsymbol", "mathtools", "color", "cancel", "braket"], maxBuffer: 20000, formatError: (_jax, error) => { throw error; } });
  const document = mathjax.document("", { InputJax: input, OutputJax: new SVG({ fontCache: "none" }) });
  const node = document.convert(`${preamble}\n${tex}`, { display: true, em: 16, ex: 8, containerWidth: 80 * 16 });
  const svg = adaptor.tags(node, "svg")[0];
  if (!svg || adaptor.tags(svg, "merror").length) throw new Error("Unable to render this equation.");
  const [, , vw, vh] = adaptor.getAttribute(svg, "viewBox").split(/\s+/).map(Number);
  const width = Math.max(1, vw / 1000 * 16 * scale);
  const height = Math.max(1, vh / 1000 * 16 * scale);
  adaptor.setAttribute(svg, "width", String(width));
  adaptor.setAttribute(svg, "height", String(height));
  adaptor.setAttribute(svg, "color", "#000000");
  adaptor.removeAttribute(svg, "style");
  const result = { svg: adaptor.outerHTML(svg), width, height };
  cache.set(key, result);
  if (cache.size > 128) cache.delete(cache.keys().next().value);
  return result;
}
