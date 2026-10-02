import { rollup } from "rollup";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { readFile, readdir } from "node:fs/promises";
export async function buildMathRuntime(entry, name) {
  const bundle = await rollup({ input: entry, plugins: [nodeResolve({ browser: true, preferBuiltins: false }), commonjs()], onwarn(warning, warn) { if (warning.code !== "CIRCULAR_DEPENDENCY") warn(warning); } });
  try {
    const { output } = await bundle.generate({ format: "iife", name, inlineDynamicImports: true, compact: true });
    return output[0].code;
  } finally { await bundle.close(); }
}
export async function mathFonts() {
  const directory = "node_modules/mathlive/fonts";
  return Promise.all((await readdir(directory)).filter(name => name.endsWith(".woff2")).map(async name => {
    const [family, face] = name.replace(".woff2", "").split("-");
    return { family, style: face.includes("Italic") ? "italic" : "normal", weight: face.includes("Bold") ? "700" : "400", data: (await readFile(`${directory}/${name}`)).toString("base64") };
  }));
}
