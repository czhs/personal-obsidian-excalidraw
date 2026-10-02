/** Run the overlay against the real drawing renderer in an isolated Electron fixture. */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import electron from '../setup-app/node_modules/electron/index.js';
import { buildReactRuntime } from './buildReactRuntime.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'codeblock-arrows-'));
try {
  const runtime = await buildReactRuntime({ isProduction: true });
  const renderer = await readFile('node_modules/@zsviczian/excalidraw/dist/obsidian/excalidraw.development.js', 'utf8');
  const overlay = ts.transpileModule(await readFile('src/utils/codeBlockArrowOverlay.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText.replace('export function', 'function');
  const css = await readFile('styles.css', 'utf8');
  await writeFile(path.join(root, 'index.html'), `<!doctype html><style>${css}
    body { margin:0; background:white; }
    .excalidraw__embeddable-container__inner { position:absolute; left:100px; top:100px; width:400px; height:200px; overflow:hidden; background:#fff; }
    pre { font:18px monospace; margin:40px; }
    </style><div class="excalidraw__embeddable-container__inner"><pre id="host">def train(model):\n    loss = model(batch)\n    return loss</pre></div>`);
  await writeFile(path.join(root, 'runtime.js'), `${runtime}\n${renderer}\n${overlay}\nvoid 0;`);
  await writeFile(path.join(root, 'fixture.js'), `(${fixture.toString()})()`);
  await writeFile(path.join(root, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const fs = require('node:fs');
    app.setPath('userData', ${JSON.stringify(path.join(root, 'profile'))});
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show:false, width:650, height:450, webPreferences:{ offscreen:true, backgroundThrottling:false } });
      win.webContents.on('console-message', (event) => console.log(event.message));
      try {
        await win.loadFile(${JSON.stringify(path.join(root, 'index.html'))});
        await win.webContents.executeJavaScript(fs.readFileSync(${JSON.stringify(path.join(root, 'runtime.js'))}, 'utf8'));
        console.log(await win.webContents.executeJavaScript(fs.readFileSync(${JSON.stringify(path.join(root, 'fixture.js'))}, 'utf8')));
        const image = await win.webContents.capturePage();
        fs.writeFileSync('/tmp/codeblock-arrow-overlay.png', image.toPNG());
        const bitmap = image.toBitmap(); const { width, height } = image.getSize();
        let redInside = 0;
        for(let y = Math.floor(height*0.4); y < height*0.5; y++) {
          for(let x = Math.floor(width*0.35); x < width*0.5; x++) {
            const i=(y*width+x)*4;
            if(bitmap[i+2]>150 && bitmap[i]<100 && bitmap[i+1]<100) redInside++;
          }
        }
        if(redInside < 20) throw Error('Arrow pixels are not visible inside the code block: '+redInside);
        console.log('PASS: arrowhead and shaft visibly reach inside the code block ('+redInside+' red pixels)');
        app.exit(0);
      } catch(error) { console.error(error); app.exit(1); }
    });
  `);
  const { stdout } = await promisify(execFile)(electron, [path.join(root, 'main.cjs')], { timeout: 60000 });
  console.log(stdout.trim());
} finally {
  await rm(root, { recursive: true, force: true });
}

async function fixture() {
  const check = (condition, message) => { if (!condition) throw Error(message); };
  // Obsidian's SVG helper, supplied only to this standalone DOM fixture.
  Element.prototype.createSvg = function(tag, options = {}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (options.cls) node.setAttribute('class', options.cls);
    for (const [key, value] of Object.entries(options.attr ?? {})) node.setAttribute(key, value);
    this.append(node);
    return node;
  };
  const lib = ExcalidrawLib;
  const host = document.getElementById('host');
  let scene = lib.restoreElements([
    { id:'code', type:'embeddable', x:100, y:100, width:400, height:200, link:'excalidraw-codeblock://editor' },
    { id:'arrow', type:'arrow', x:20, y:200, width:280, height:0, points:[[0,0],[280,0]], strokeColor:'#ff0000', strokeWidth:3, roughness:0,
      endArrowhead:'arrow', endBinding:{elementId:'code',mode:'inside',fixedPoint:[0.5,0.5]} },
  ], null);
  const initial = JSON.stringify(scene);
  let state = { theme:'light', exportBackground:false };
  const listeners = new Set();
  const api = {
    getSceneElements: () => scene,
    getAppState: () => state,
    onChange: (callback) => { listeners.add(callback); return () => listeners.delete(callback); },
  };
  const change = () => listeners.forEach((listener) => listener());
  const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const waitFor = async (predicate) => {
    for(let i=0;i<100;i++) { if(predicate()) return; await nextPaint(); }
    throw Error('Timed out waiting for overlay');
  };
  let exports = 0;
  const instrumented = { ...lib, exportToSvg: async (opts) => { exports++; return lib.exportToSvg(opts); } };
  const dispose = mountCodeBlockArrowOverlay(host, 'code', api, instrumented);
  const overlay = () => document.querySelector('.excalidraw-code-block__arrows');
  const svg = () => overlay()?.querySelector('g > svg');
  await waitFor(svg);
  check(svg().querySelector('[stroke="#ff0000"]'), 'Native renderer must retain the arrow color');
  check(overlay().getAttribute('viewBox') === '0 0 400 200', 'Overlay must use scene dimensions');
  check(Number(svg().getAttribute('x')) === -110, 'Native export must align with scene x coordinates');
  check(getComputedStyle(svg()).pointerEvents === 'none', 'Overlay must not intercept code editing or arrow dragging');
  check(JSON.stringify(scene) === initial, 'Rendering must not modify persisted geometry or bindings');
  const count = exports;
  state = { ...state, zoom:{value:2}, scrollX:50, scrollY:30 };
  change(); await nextPaint();
  check(exports === count, 'Pan and zoom must not re-export annotations');
  const foreground = [...scene];
  scene = [scene[1], scene[0]]; change();
  await waitFor(() => !svg());
  check(!svg(), 'An arrow sent behind the block must stay behind it');
  scene = foreground; change(); await waitFor(svg);
  scene = [scene[0]]; change(); await waitFor(() => !svg());
  scene = foreground; change(); await waitFor(svg);
  const arrow = scene[1];
  scene = [scene[0], {...arrow, points:[[0,0],[320,30]], width:320, height:30, version:arrow.version+1}];
  const before = svg(); change(); await waitFor(() => svg() && svg() !== before);
  check(JSON.stringify(scene[1].endBinding) === JSON.stringify(arrow.endBinding), 'Arrow edits must preserve interior binding');
  scene = [{...scene[0],angle:Math.PI/4}, scene[1]]; change();
  await waitFor(() => overlay().querySelector('g').getAttribute('transform') === 'rotate(-45 200 100)');
  scene = [{...scene[0],width:600,height:300}, scene[1]]; change();
  await waitFor(() => overlay().getAttribute('viewBox') === '0 0 600 300');
  dispose();
  check(listeners.size === 0 && !overlay(), 'Unmount must remove subscription and SVG');
  let release;
  scene = foreground;
  const pendingDispose = mountCodeBlockArrowOverlay(host, 'code', api, {
    ...lib, exportToSvg: () => new Promise((resolve) => { release = resolve; }),
  });
  await waitFor(() => release);
  pendingDispose();
  release(await lib.exportToSvg({ elements:[arrow], appState:{exportBackground:false}, files:null }));
  await nextPaint();
  check(!overlay(), 'A late async export must not resurrect an unmounted overlay');
  mountCodeBlockArrowOverlay(host, 'code', api, lib);
  await waitFor(svg);
  return 'PASS: real renderer, coordinate alignment, unchanged bindings, pointer pass-through, pan/zoom cache, layer order, deletion/undo, arrow edit, rotation, resize, cleanup and late-export cancellation';
}
