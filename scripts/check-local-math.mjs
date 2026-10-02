import assert from "node:assert/strict";
import { render, clear } from "./mathRendererEntry.mjs";
const formulas = [
  String.raw`\frac{a}{b}`, String.raw`x^{n+1}`, String.raw`\sqrt{x^2+y^2}`,
  String.raw`\sum_{i=1}^{n}x_i`, String.raw`\prod_{i=1}^{n}p_i`, String.raw`\int_0^1 f(x)\,dx`,
  String.raw`\frac{\partial\mathcal{L}}{\partial\theta}`, String.raw`\nabla_{\boldsymbol{\theta}}\mathcal{L}`,
  String.raw`\mathbf{x}\in\mathbb{R}^d`, String.raw`\vec{x}`, String.raw`\begin{bmatrix}x_1\\x_2\\x_3\end{bmatrix}`,
  String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`, String.raw`\mathbb{E}_{x\sim p(x)}[f(x)]`,
  String.raw`\lVert\mathbf{x}\rVert_2`, String.raw`\mathbf{x}^{\mathsf{T}}\mathbf{y}`,
  String.raw`\operatorname{softmax}(z)_i=\frac{e^{z_i}}{\sum_j e^{z_j}}`,
  String.raw`\begin{aligned}h&=\sigma(Wx+b)\\\mathcal{L}&=-\sum_i y_i\log p_i\end{aligned}`,
];
const times = [];
for (const formula of formulas) {
  const start = performance.now(); const result = render(formula); times.push(performance.now()-start);
  assert(result.width > 0 && result.height > 0);
  assert(result.svg.startsWith("<svg"));
  assert(!/NaN|Infinity|<script|<foreignObject|https?:\/\/(?!www\.w3\.org)/.test(result.svg));
  assert.equal(render(formula), result, "repeated equations reuse cached SVG");
}
assert.throws(() => render(String.raw`\frac{`));
assert.throws(() => render(String.raw`\unknownMLcommand{x}`));
assert.throws(() => render("x".repeat(20001)));
const macro = render(String.raw`\vect{x}`, 4, String.raw`\newcommand{\vect}[1]{\mathbf{#1}}`);
assert(macro.width > 0);
assert.throws(() => render(String.raw`\vect{x}`), "macros must not leak across equations");
assert.equal(render("x", 2).width, render("x", 1).width * 2);
clear();
console.log(`PASS: ${formulas.length} ML formulas, vector/matrix SVG, invalid input, preamble isolation, scaling, cache; cold ${times[0].toFixed(1)}ms, warm median ${times.slice(1).sort((a,b)=>a-b)[8].toFixed(1)}ms`);
