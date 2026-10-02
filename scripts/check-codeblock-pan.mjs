/** Exercise code-block gestures with the installed canvas wheel handler in Electron. */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import electron from '../setup-app/node_modules/electron/index.js';
import { buildReactRuntime } from './buildReactRuntime.mjs';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const root = await mkdtemp(path.join(os.tmpdir(), 'codeblock-pan-'));
try {
  const runtime = await buildReactRuntime({ isProduction: true });
  const renderer = (await readFile('node_modules/@zsviczian/excalidraw/dist/obsidian/excalidraw.development.js', 'utf8'))
    .replace('var AppWheel = class', 'var AppWheel = globalThis.TestAppWheel = class');
  const forwarding = ts.transpileModule(await readFile('src/utils/codeBlockWheel.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText.replace('export function', 'function');
  // Read the production handlers so the fixture catches regressions in the
  // component itself, then exercise them with real CodeMirror clipboard logic.
  const component = ts.createSourceFile('CodeBlockEmbeddable.tsx', await readFile('src/view/components/CodeBlockEmbeddable.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handlers;
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.expression.getText(component) === 'EditorView.domEventHandlers') handlers = node.arguments[0].getText(component);
    ts.forEachChild(node, visit);
  };
  visit(component);
  if (!handlers) throw Error('CodeMirror event handlers not found');
  const clipboardEntry = `
    import { EditorView } from '@codemirror/view';
    import { EditorState } from '@codemirror/state';
    import { history, undo } from '@codemirror/commands';
    globalThis.clipboardFixture = { EditorView, EditorState, history, undo, handlers:${handlers} };
  `;
  const bundle = await rollup({input:'clipboard-fixture', plugins:[
    { name:'clipboard-fixture', resolveId:id => id === 'clipboard-fixture' ? id : null, load:id => id === 'clipboard-fixture' ? clipboardEntry : null },
    nodeResolve({browser:true}),
  ]});
  const clipboardRuntime = (await bundle.generate({format:'iife'})).output[0].code;
  await bundle.close();
  await writeFile(path.join(root, 'index.html'), '<!doctype html><div class="excalidraw"><canvas class="excalidraw__canvas"></canvas><div id="block"><header>Python</header><div id="editor" contenteditable="true">print(1)</div></div></div>');
  await writeFile(path.join(root, 'runtime.js'), `${runtime}\n${renderer}\n${forwarding}\n${clipboardRuntime}\n(${fixture.toString()})()`);
  await writeFile(path.join(root, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    const fs = require('node:fs');
    app.setPath('userData', ${JSON.stringify(path.join(root, 'profile'))});
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show:false, webPreferences:{ offscreen:true } });
      try {
        await win.loadFile(${JSON.stringify(path.join(root, 'index.html'))});
        console.log(await win.webContents.executeJavaScript(fs.readFileSync(${JSON.stringify(path.join(root, 'runtime.js'))}, 'utf8')));
        app.exit(0);
      } catch(error) { console.error(error); app.exit(1); }
    });
  `);
  const { stdout } = await promisify(execFile)(electron, [path.join(root, 'main.cjs')], { timeout:60000 });
  console.log(stdout.trim());
} finally {
  await rm(root, { recursive:true, force:true });
}

function fixture() {
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const block = document.getElementById('block');
  const editor = document.getElementById('editor');
  const canvas = document.querySelector('canvas');
  let translations = 0;
  const app = {
    ownerWindow: window,
    state: { scrollX:0, scrollY:0, zoom:{value:2}, inputDevice:'trackpad', allowWheelZoom:false },
    isNavigationEnabled: () => true,
    pan: { isActive: () => false },
    viewport: { translate: (update) => { Object.assign(app.state, update(app.state)); translations++; } },
  };
  const wheel = new TestAppWheel(app);
  let zoomDelta;
  wheel.zoomBy = (delta) => { zoomDelta = delta; };
  document.querySelector('.excalidraw').addEventListener('wheel', wheel.handle, {passive:false});
  let editorWheels = 0;
  editor.addEventListener('wheel', () => { editorWheels++; });
  const send = (target, options) => {
    const event = new WheelEvent('wheel', { bubbles:true, cancelable:true, ...options });
    target.dispatchEvent(event);
    return event;
  };
  const dispose = mountCodeBlockWheelForwarding(block);
  editor.focus();
  const event = send(editor, {deltaX:40, deltaY:60});
  check(app.state.scrollX === -20 && app.state.scrollY === -30, 'Diagonal pan must use canvas zoom scaling');
  check(translations === 1 && editorWheels === 0 && event.defaultPrevented, 'Gesture must navigate once without scrolling editor');
  check(document.activeElement === editor && editor.textContent === 'print(1)', 'Pan must retain focus and code');
  send(editor, {deltaX:-10});
  check(app.state.scrollX === -15 && app.state.scrollY === -30, 'Horizontal pan');
  send(block.querySelector('header'), {deltaY:20});
  check(app.state.scrollY === -40, 'Header must also pan');
  send(editor, {deltaY:10, shiftKey:true});
  check(app.state.scrollX === -20 && app.state.scrollY === -40, 'Shift navigation must match canvas');
  send(editor, {deltaY:-5, ctrlKey:true});
  check(zoomDelta === -5, 'Pinch must reach canvas zoom');
  zoomDelta = null;
  send(editor, {deltaY:5, metaKey:true});
  check(zoomDelta === 5, 'Command-wheel must reach canvas zoom');
  const before = translations;
  send(canvas, {deltaY:20});
  check(translations === before + 1, 'Normal canvas events must not duplicate');
  dispose();
  const after = translations;
  send(editor, {deltaY:20});
  check(translations === after && editorWheels === 1, 'Unmount must remove forwarding');
  const disposeAgain = mountCodeBlockWheelForwarding(block);
  canvas.remove();
  check(!send(editor, {deltaY:20}).defaultPrevented, 'Missing canvas must leave native scroll available');
  disposeAgain();
  const { EditorView, EditorState, history, undo, handlers } = clipboardFixture;
  const cm = new EditorView({parent:block, state:EditorState.create({
    doc:'print(1)\nprint(2)', selection:{anchor:0, head:8},
    extensions:[history(), EditorView.domEventHandlers(handlers)],
  })});
  cm.focus();
  let canvasClipboardEvents = 0;
  const onClipboard = () => { canvasClipboardEvents++; };
  for (const type of ['copy', 'cut', 'paste']) document.addEventListener(type, onClipboard);
  const clipboard = (type, text) => {
    const data = new DataTransfer();
    if (text) data.setData('text/plain', text);
    cm.contentDOM.dispatchEvent(new ClipboardEvent(type, {bubbles:true, cancelable:true, clipboardData:data}));
    return data.getData('text/plain');
  };
  check(clipboard('copy') === 'print(1)' && cm.state.doc.toString() === 'print(1)\nprint(2)', 'Copy must copy only selected code');
  check(clipboard('cut') === 'print(1)' && cm.state.doc.toString() === '\nprint(2)', 'Cut must remove selected code');
  check(undo(cm) && cm.state.doc.toString() === 'print(1)\nprint(2)', 'Code cut must be undoable');
  cm.dispatch({selection:{anchor:0, head:8}});
  clipboard('paste', 'print(3)');
  check(cm.state.doc.toString() === 'print(3)\nprint(2)', 'Paste must replace selected code');
  cm.dispatch({selection:{anchor:0}});
  check(clipboard('cut') === 'print(3)' && cm.state.doc.toString() === 'print(2)', 'Cut without selection must cut current code line');
  check(canvasClipboardEvents === 0, 'Code clipboard events must never reach canvas handlers');
  for (const type of ['copy', 'cut', 'paste']) document.removeEventListener(type, onClipboard);
  cm.destroy();
  return 'PASS: pan, zoom, focus, cleanup, real CodeMirror copy/cut/paste, line cut, undo, and clipboard isolation from canvas';
}
