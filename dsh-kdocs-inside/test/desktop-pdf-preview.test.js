/** 桌面官方 PDF 导航、Session 隔离、错误留页与 Web iframe 回归。 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/** The shipped bundle source, read once. */
const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

/**
 * Evaluate the shipped bundle with a chosen `window.location.protocol`.
 *
 * The React stub **stores state**, because half of what this file asserts lives
 * behind a state transition: the pane moves from "loading" to "missing" or
 * "ready", and the quote button only exists after a selection was recorded.
 * `useEffect` runs its callback immediately (after commit, in a real React), so
 * the pane's Remote call is observable without a renderer loop.
 *
 * @param {string | undefined} protocol - 'http:' for web, 'dsh-app:' for desktop.
 * @param {any} [hooks] - `{ window, onRequireAsync, initial }` recording points.
 * @returns {any} the module the bundle builds, plus `__react`.
 */
function loadBundle(protocol, hooks = {}) {
  /** @type {any[]} */
  const registered = [];
  const stub = {
    __ModuleLoader__: {
      /** @param {any} registration */
      load(registration) {
        registered.push(registration);
      },
    },
    ...(hooks.window ?? {}),
  };
  if (protocol !== undefined) stub.location = { protocol };
  // eslint-disable-next-line no-new-func -- evaluating the shipped bundle is the point
  new Function('window', SOURCE)(stub);

  const cells = [];
  const refs = [];
  const effectSlots = [];
  let call = 0;

  /** Object.is over a dependency list, the comparison React makes. */
  const sameDeps = (left, right) => Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useCallback: (fn) => fn,
    /**
     * Effects run immediately (as they do after commit) and **only when their
     * dependencies changed** — the whole point of this stub.
     *
     * A stub that re-ran every effect on every render would hide the bug this
     * file now guards: the PDF pane's effect depends on a `fileRef` object that
     * `KDocsPreview` rebuilds on each render, so an unrelated re-render tears the
     * viewer down (blank) and mounts a fresh one — which is exactly the flicker a
     * reader reported from the desktop app.
     */
    useEffect: (fn, deps) => {
      const index = call;
      call += 1;
      const slot = effectSlots[index];
      if (slot === undefined) {
        effectSlots[index] = { deps, fn, cleanup: fn() };
        return;
      }
      if (deps === undefined || !sameDeps(slot.deps, deps)) {
        if (typeof slot.cleanup === 'function') slot.cleanup();
        slot.deps = deps;
        slot.fn = fn;
        slot.cleanup = fn();
      }
    },
    useRef: (value) => {
      const index = call;
      call += 1;
      if (!(index in refs)) refs[index] = { current: value };
      return refs[index];
    },
    useState: (value) => {
      call += 1;
      const index = call;
      const initial = typeof value === 'function' ? value() : value;
      if (!(index in cells)) {
        cells[index] = typeof hooks.initial === 'function' ? hooks.initial(index, initial) : initial;
      }
      return [cells[index], (next) => {
        cells[index] = typeof next === 'function' ? next(cells[index]) : next;
      }];
    },
  };
  // Reset between component invocations so call #1 means "this component's first hook".
  react.__resetHooks = () => {
    call = 0;
  };
  /** Run every effect's cleanup, as unmounting would. */
  react.__unmount = () => {
    for (const slot of effectSlots) {
      if (typeof slot?.cleanup === 'function') slot.cleanup();
      if (slot !== undefined) slot.cleanup = undefined;
    }
  };

  const require_ = (specifier) => {
    if (specifier === 'react') return react;
    if (specifier === 'react/jsx-runtime') {
      return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
    }
    throw new Error(`unexpected require: ${specifier}`);
  };
  // Nothing in this package loads a PDF chunk any more. The stub is deliberately
  // strict: if a `require.async` reappears, the test goes red rather than quiet.
  require_.async = async (spec) => {
    if (typeof hooks.onRequireAsync === 'function') hooks.onRequireAsync(spec);
    throw new Error(`unexpected chunk request: ${spec}`);
  };

  const mod = registered[0].factory(require_);
  mod.__react = react;
  return mod;
}

/** A real document address, the shape the panel emits. */
const REF = { driveId: 'drive', fileId: 'file' };
const ADDRESS = 'dsh-resource://kdocs/file/100000001/publicDocumentFixture';

/**
 * Walk a rendered stub tree looking for one prop marker.
 *
 * @param {any} node - the element tree root.
 * @param {string} marker - the prop name to find.
 * @returns {any} the element carrying it, or undefined.
 */
function findByMarker(node, marker) {
  if (node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByMarker(child, marker);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (node.props !== null && typeof node.props === 'object' && marker in node.props) return node;
  return findByMarker(node.props?.children, marker);
}

/**
 * Walk a rendered stub tree looking for an element of one component type.
 *
 * @param {any} node - the element tree root.
 * @param {any} type - the component function to find.
 * @returns {any} the element, or undefined.
 */
function findByType(node, type) {
  if (node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByType(child, type);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (node.type === type) return node;
  return findByType(node.props?.children, type);
}

/**
 * Props for one preview render, with a recording Remote.
 *
 * @param {any} [overrides] - props to override.
 * @returns {any} the props.
 */
function previewProps(overrides = {}) {
  return {
    t: (key) => key,
    useTabInfo: () => ({ tab: { contentId: ADDRESS, signal: { aborted: false } } }),
    useResource: () => ({ value: { name: 'sample.docx' } }),
    remote: { read: () => new Promise(() => undefined), preparePreview: () => new Promise(() => undefined) },
    ...overrides,
  };
}

describe('the shell gate', () => {
  it('defaults to web unless the page can prove it is the desktop shell', () => {
    assert.equal(loadBundle(undefined).IS_DESKTOP_SHELL, false);
    assert.equal(loadBundle('http:').IS_DESKTOP_SHELL, false, 'the web profile is http: on 127.0.0.1');
    assert.equal(loadBundle('dsh-app:').IS_DESKTOP_SHELL, true);
  });
});

describe('web keeps the iframe, and only the iframe (negative control)', () => {
  it('renders the embed frame and no PDF pane', () => {
    const mod = loadBundle('http:');
    const tree = mod.KDocsPreview(previewProps());
    assert.ok(findByMarker(tree, 'data-kdocs-embed'), 'the web renders the iframe embed');
    // The pane is a component element before it renders, so the marker alone
    // would not catch a leak — the type check is the real guard.
    assert.equal(findByType(tree, mod.KDocsOfficialPreview), undefined, 'no PDF pane element on the web');
    assert.equal(findByMarker(tree, 'data-kdocs-pdf-area'), undefined, 'and no PDF selection surface either');
  });

  it('gates the iframe and the pane on opposite sides of the flag at source level', () => {
    // If either side loses its gate, both shells render both surfaces.
    assert.match(SOURCE, /const embedding = embedRequested && !IS_DESKTOP_SHELL;/);
    assert.match(SOURCE, /const pdfPreview = embedRequested && IS_DESKTOP_SHELL;/);
  });
});

describe('官方文件预览接入', () => {
  it('桌面保留文本阅读入口，不默认创建第二个自动跳转页签', () => {
    const mod = loadBundle('dsh-app:');
    const tree = mod.KDocsPreview(previewProps());
    assert.equal(findByMarker(tree, 'data-kdocs-embed'), undefined);
    assert.equal(findByMarker(tree, 'data-kdocs-pdf-area'), undefined);
  });

  it('没有 PDF Viewer 插件仍通过当前 Session 的官方资源入口打开文件', async () => {
    const mod = loadBundle('dsh-app:'); const opens = []; const reads = [];
    const props = { sessionId: 'session-A', remote: { preparePreview: async () => ({ ok: true, value: { kind: 'pdf-file', absolutePath: 'C:\\Users\\Test\\合同.pdf' } }) }, workspaceFiles: { stat: async (...args) => { reads.push(args); return { ok: true }; } } };
    const tab = { signal: new AbortController().signal, actions: { openResource: address => opens.push(address) } };
    await mod.openOfficialPreview(props, REF, tab);
    assert.equal(reads[0][0], 'session-A');
    assert.equal(opens[0], 'dsh-resource://file/session/session-A/C:/Users/Test/%E5%90%88%E5%90%8C.pdf');
    props.sessionId = 'session-B'; await mod.openOfficialPreview(props, REF, tab);
    assert.ok(opens[1].includes('/session-B/'));
    assert.equal(mod.publishPdfViewer, undefined);
  });

  it('准备失败、文件访问被拒绝、缺失 Session 均不打开页签', async () => {
    const mod = loadBundle('dsh-app:'); let opened = false;
    const tab = { signal: new AbortController().signal, actions: { openResource: () => { opened = true; } } };
    const props = { sessionId: 's', remote: { preparePreview: async () => ({ ok: false, error: { message: '下载权限' } }) } };
    await assert.rejects(mod.openOfficialPreview(props, REF, tab), /下载权限/);
    props.remote.preparePreview = async () => ({ ok: true, value: { kind: 'pdf-file', absolutePath: '/tmp/a.pdf' } });
    props.workspaceFiles = { stat: async () => ({ ok: false }) };
    await assert.rejects(mod.openOfficialPreview(props, REF, tab), /本地文件访问权限/);
    delete props.sessionId; await assert.rejects(mod.openOfficialPreview(props, REF, tab), /Session/);
    assert.equal(opened, false);
  });
});

 it('图片同样通过当前Session的本地资源入口交给官方查看器', async () => {
  const mod = loadBundle('dsh-app:'); const opens = [];
  const props = { sessionId: 'image-session', remote: { preparePreview: async () => ({ok:true,value:{kind:'image-file',absolutePath:'/tmp/public.png'}}) }, workspaceFiles:{stat:async()=>({ok:true})} };
  const tab = {signal:new AbortController().signal,actions:{openResource:a=>opens.push(a)}};
  await mod.openOfficialPreview(props, REF, tab);
  assert.equal(opens[0],'dsh-resource://file/session/image-session//tmp/public.png');
 });
