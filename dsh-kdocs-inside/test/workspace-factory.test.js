/**
 * The `kdocs.workspace` factory: the browse/preview surface another plugin can
 * render in its own main workspace.
 *
 * The factory exists because a consumer (the bankruptcy assistant's main
 * workspace) must not import this package's client code, inject `remote.kdocs`,
 * or hold this plugin's services. It calls
 * `renderFactorySlot('kdocs.workspace', {})` and gets everything from here.
 *
 * What is pinned, and why each one can silently rot:
 *
 * 1. **Browse and preview stay in the consuming surface.** The factory routes a
 *    kdocs address into its own preview instead of calling the right sidebar's
 *    `openResource`; if that line regresses the panel still "works" — it just
 *    teleports the reader into a different surface, which no other test notices.
 * 2. **A non-kdocs address goes back to the right sidebar.** Official file /
 *    image previews produce `dsh-resource://file/session/…` addresses; rendering
 *    them here would mean a second renderer, which this plugin does not have.
 * 3. **Quoting reads the Session active at click time.** The component subscribes
 *    to the active Session, so a stale id here writes a marker into the previous
 *    conversation — a failure the product would not show at all.
 * 4. **Place memory is per surface.** The right sidebar keeps the historical
 *    module-level memory; this surface has its own. Sharing it makes the two
 *    panels move each other.
 * 5. **The registration is the contract.** `apply` registers exactly
 *    `{ name: 'kdocs.workspace', scope: 'root' }`, which is what a consumer writes
 *    in `renderFactorySlot`.
 *
 * The React stub is the one `panel-interaction.test.js` uses (real state cells,
 * effects on dependency change, one level of function-component reconciliation),
 * because the shipped bundle is a classic script and the point is to drive it.
 * Its cursor discipline is the same: `render` resets the cursor, and a component
 * tree is only executed while walking a tree produced by that very render — so
 * every helper here renders immediately before it walks.
 *
 * @module kdocs/test/workspace-factory
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

/**
 * Evaluate the shipped bundle with a drivable React stub.
 *
 * @param {{ source?: string, window?: any }} [options] - source/window overrides.
 * @returns {{ mod: any, render: (fn: any, props: any) => any }} the module and a renderer.
 */
function loadBundle(options = {}) {
  const registered = [];
  // eslint-disable-next-line no-new-func -- evaluating the shipped bundle is the point
  new Function('window', options.source ?? SOURCE)({
    ...globalThis.window, ...options.window, __ModuleLoader__: { load: (r) => registered.push(r) },
  });

  const slots = [];
  let cursor = 0;
  const react = {
    Component: class {
      /** @param {any} props */
      constructor(props) { this.props = props; }
      /** @param {any} next */
      setState(next) { this.state = { ...this.state, ...next }; }
    },
    useState: (init) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init;
      return [slots[i], (v) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }];
    },
    useRef: (init) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: init };
      return slots[i];
    },
    useCallback: (fn) => fn,
    useEffect: (fn, deps) => {
      const i = cursor++;
      const prev = slots[i];
      const changed = prev === undefined || deps === undefined || prev.deps === undefined
        || deps.some((d, j) => d !== prev.deps[j]);
      if (changed) {
        if (prev?.cleanup) prev.cleanup();
        slots[i] = { deps, cleanup: fn() || undefined };
      }
    },
  };
  const jsx = (type, config) => ({ type, props: config ?? {} });
  const mod = registered[0].factory((specifier) => {
    if (specifier === 'react') return react;
    if (specifier === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    throw new Error(`unexpected require: ${specifier}`);
  });

  return {
    mod,
    /** Render one component; the stub's cursor restarts per render pass. */
    render(Component, props) {
      cursor = 0;
      return Component(props);
    },
  };
}

/** Walk a rendered tree, entering function components, visiting every element. */
function findAll(node, pred, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, pred, out);
    return out;
  }
  if (pred(node)) out.push(node);
  if (typeof node.type === 'function') {
    findAll(node.type(node.props), pred, out);
    return out;
  }
  return findAll(node.props?.children, pred, out);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FILE = { ref: { driveId: '1', fileId: 'F1' }, name: '合同.docx', kind: 'file', extension: 'docx' };
const FOLDER = { ref: { driveId: '1', fileId: 'D1' }, name: '案件', kind: 'directory' };
const CHILD = { ref: { driveId: '1', fileId: 'C1' }, name: '子项.docx', kind: 'file', extension: 'docx' };

before(() => {
  globalThis.window = { innerWidth: 1024, innerHeight: 768, localStorage: undefined };
  globalThis.document = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
});

after(() => {
  delete globalThis.window;
  delete globalThis.document;
});

/**
 * One workspace surface with recording stubs.
 *
 * @param {{ desktop?: boolean, insertResult?: boolean, session?: string|undefined }} [options] - surface switches.
 * @returns {any} the wiring, its recordings, a query face and the Session switch.
 */
function setup(options = {}) {
  const calls = { list: [], read: [], insert: [], openResource: [], openTab: [] };
  const remote = {
    listSorted: async (parent, cursor, sortOptions, signal) => remote.list(parent, cursor, signal),
    list: async (parent) => {
      calls.list.push(parent);
      const entries = parent === undefined || parent === null ? [FOLDER, FILE] : [CHILD];
      return { ok: true, value: { entries } };
    },
    read: async (ref, readOptions, signal) => {
      calls.read.push({ ref, signal });
      return { ok: true, value: { content: '# 正文', format: 'md', truncated: false } };
    },
    preparePreview: async () => ({ ok: true, value: { kind: 'pdf-file', absolutePath: 'tmp/a.pdf' } }),
    status: async () => ({ ok: true, value: { authenticated: true } }),
  };
  const workspaceFiles = { stat: async () => ({ ok: true, value: {} }) };
  let session = 'session' in options ? options.session : 'S1';
  const listeners = new Set();
  const { mod, render } = loadBundle(options.desktop === true ? { window: { location: { protocol: 'dsh-app:' } } } : {});
  const View = mod.createKDocsWorkspace({
    t: (key) => key,
    remote,
    workspaceFiles,
    sessionSource: {
      get: () => session,
      subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    },
    insertReference: (marker, sessionId) => {
      calls.insert.push({ marker, sessionId });
      return options.insertResult ?? true;
    },
    openResource: (address) => calls.openResource.push(address),
    openTab: (kind, tabOptions) => calls.openTab.push({ kind, tabOptions }),
  });

  /**
   * Render the surface and execute its function children, so their hooks run at
   * the same slot positions every time.
   *
   * @param {(node: any) => boolean} pred - what to collect.
   * @returns {any[]} matching nodes from this render pass.
   */
  const find = (pred) => findAll(render(View, {}), pred);

  return {
    mod, render, View, calls, remote, find,
    /** Click one row in a fresh pass. */
    clickRow(kind) {
      find((n) => n.props?.['data-kdocs-row'] === kind)[0].props.onClick();
    },
    switchSession(id) { session = id; for (const listener of listeners) listener(); },
  };
}

/** Mount the surface and let the root listing settle. */
async function mount(seam) {
  seam.find(() => false);
  await sleep(10);
  seam.find(() => false);
}

const workspaceKind = (seam) => seam.find((n) => n.props?.['data-kdocs-workspace'] !== undefined)[0]
  ?.props['data-kdocs-workspace'];

/** Open the file row's context menu and press one item. */
async function pressMenu(seam, item) {
  seam.find((n) => n.props?.['data-kdocs-row'] === 'file')[0]
    .props.onContextMenu({ preventDefault() {}, clientX: 20, clientY: 20 });
  const button = seam.find((n) => n.props?.['data-kdocs-menu-item'] === item)[0];
  assert.ok(button, `menu item ${item}`);
  await button.props.onClick();
  await sleep(5);
}

describe('kdocs.workspace：浏览与预览都留在消费方的主工作区', () => {
  it('挂载后渲染浏览面板，不占用右栏资源入口', async () => {
    const seam = setup();
    await mount(seam);
    assert.equal(workspaceKind(seam), 'browse');
    assert.ok(seam.find((n) => n.props.children === FILE.name).length, '文件行可见');
    assert.deepEqual(seam.calls.openResource, [], '浏览不委托右栏');
    assert.deepEqual(seam.calls.openTab, [], '浏览不打开浏览器页签');
  });

  it('点击文件在同一工作区打开预览，返回后回到列表', async () => {
    const seam = setup();
    await mount(seam);
    seam.clickRow('file');
    assert.equal(workspaceKind(seam), 'preview');
    assert.ok(seam.find((n) => n.props['data-kdocs-workspace-back'] === 'true').length, '有返回列表按钮');
    assert.deepEqual(seam.calls.openResource, [], '预览没有跑到右栏');
    const read = seam.calls.read.at(-1);
    assert.ok(read, '预览读取了正文');

    seam.find((n) => n.props['data-kdocs-workspace-back'] === 'true')[0].props.onClick();
    assert.equal(workspaceKind(seam), 'browse');
    assert.equal(read.signal.aborted, true, '离开预览就取消这次读取');
  });

  it('非 kdocs 地址（官方文件预览）交回右栏，不在这里再次渲染', async () => {
    const seam = setup({ desktop: true });
    await mount(seam);
    // 桌面 shell 的 PDF/Word 行走官方缓存预览，成功后把 session 资源交给导航。
    seam.clickRow('file');
    await sleep(10);
    assert.deepEqual(seam.calls.openResource, ['dsh-resource://file/session/S1/tmp/a.pdf']);
    assert.equal(workspaceKind(seam), 'browse', '本工作区没有变成第二个文件渲染器');
  });
});

describe('kdocs.workspace：引用写到点击时活跃的会话', () => {
  it('引用用当前会话，切换会话后不写进旧会话', async () => {
    const seam = setup();
    await mount(seam);
    await pressMenu(seam, 'quote');
    assert.equal(seam.calls.insert.length, 1);
    assert.equal(seam.calls.insert[0].sessionId, 'S1');

    seam.switchSession('S2');
    await pressMenu(seam, 'quote');
    assert.equal(seam.calls.insert.at(-1).sessionId, 'S2');
    assert.equal(seam.calls.insert.length, 2);
  });

  it('没有活跃会话时给出提示且不写入', async () => {
    const seam = setup({ session: undefined });
    await mount(seam);
    await pressMenu(seam, 'quote');
    assert.deepEqual(seam.calls.insert, [], '没有会话就不写');
    const notice = seam.find((n) => n.props?.['data-kdocs-workspace-notice'] === 'true')[0];
    assert.ok(notice, '有可见提示');
    assert.equal(notice.props.children, 'workspaceQuoteUnavailable');
  });

  it('负向对照：插入失败时提示出现（成功则不出现）', async () => {
    const failing = setup({ insertResult: false });
    await mount(failing);
    await pressMenu(failing, 'quote');
    assert.ok(failing.find((n) => n.props?.['data-kdocs-workspace-notice'] === 'true').length);

    const succeeding = setup({ insertResult: true });
    await mount(succeeding);
    await pressMenu(succeeding, 'quote');
    assert.equal(succeeding.find((n) => n.props?.['data-kdocs-workspace-notice'] === 'true').length, 0);
  });
});

describe('kdocs.workspace：与右栏的位置记忆隔离', () => {
  it('主工作区展开目录不写进右栏记忆，右栏挂载仍从折叠开始', async () => {
    const seam = setup();
    await mount(seam);
    seam.clickRow('folder');
    await sleep(10);
    assert.ok(seam.find((n) => n.props.children === CHILD.name).length, '主工作区展开了子项');
    assert.deepEqual(seam.mod.panelMemory.expanded, {}, '模块级（右栏）记忆未被改写');
    assert.equal(seam.mod.panelMemory.query, '');

    // 右栏那次挂载是**另一次** bundle 实例（独立 slot 表），它用历史记忆：仍折叠。
    const sidebar = loadBundle();
    const tab = { signal: new AbortController().signal, actions: { openResource() {} } };
    const props = {
      t: (key) => key, remote: seam.remote, addressOf: sidebar.mod.kdocsAddressOf,
      useTabInfo: () => ({ tab: { ...tab, contentId: undefined } }),
      useInput: () => '', inputActions: { setDraft() {} },
    };
    sidebar.render(sidebar.mod.KDocsBody, props);
    await sleep(10);
    const tree = sidebar.render(sidebar.mod.KDocsBody, props);
    const rows = findAll(tree, (n) => n.props.children === CHILD.name);
    assert.equal(rows.length, 0, '右栏没有继承主工作区展开的位置');
  });
});

/**
 * A client context stub faithful enough for `apply` at activation time.
 *
 * `ctx.effect` runs its body (as the page does on mount); a plugin-scoped
 * `effect` is parked, matching the real ordering where those bodies run once the
 * declaration settles. `slots.registerFactory` is present only when the host has
 * the Factory API, which is exactly the compatibility branch under test.
 *
 * @param {{ factoryApi?: boolean }} [options] - omit `slots.registerFactory`.
 * @returns {any} the context and what `apply` registered on it.
 */
function applyContext(options = {}) {
  const factories = [];
  const registrations = [];
  const tabTypes = [];
  const effects = [];
  let resources = 0;
  const kdocsRemote = { list: async () => ({ ok: true, value: { entries: [] } }) };
  const workspaceFiles = { stat: async () => ({ ok: true }) };
  const slots = {
    inject(_name, fn) {
      const dispose = fn();
      return typeof dispose === 'function' ? dispose : () => undefined;
    },
    register(options, component) {
      if (options === null || typeof options !== 'object') throw new Error('slots.register requires options');
      if (typeof options.name !== 'string' || options.name === '') throw new Error('slots.register requires a name');
      if (options.key !== undefined && typeof options.key !== 'string') throw new Error('slots.register key must be a string');
      if (typeof component !== 'function') throw new Error('slots.register requires a component');
      registrations.push(options);
      return () => undefined;
    },
  };
  if (options.factoryApi !== false) {
    slots.registerFactory = (factoryOptions, component) => {
      if (typeof factoryOptions?.name !== 'string' || factoryOptions.name === '') throw new Error('slots.registerFactory requires a name');
      if (!['root', 'session', 'session-maybe'].includes(factoryOptions.scope)) throw new Error('slots.registerFactory requires a scope');
      if (typeof component !== 'function') throw new Error('slots.registerFactory requires a component');
      factories.push(factoryOptions);
      return () => undefined;
    };
  }
  const scoped = {
    remote: { kdocs: kdocsRemote, workspaceFiles },
    slots,
    configForms: { get: () => ({}) },
    // The composer faces the bundle reaches when the declaration settles.
    inputTriggers: { registerSource: () => () => undefined },
    uiConversation: { userText: { register: () => () => undefined } },
    effect(fn) {
      const cleanup = fn();
      return typeof cleanup === 'function' ? cleanup : () => undefined;
    },
  };
  const ctx = {
    effect(fn, label) {
      effects.push(label);
      const cleanup = fn();
      return typeof cleanup === 'function' ? cleanup : () => undefined;
    },
    inject(_deps, callback) { callback(scoped); return () => undefined; },
    slots,
    locale: { bind: () => (key) => key, register: () => () => undefined, subscribe: () => () => undefined },
    resources: { register: () => { resources += 1; return () => undefined; } },
    sidebarRightTabs: { register: (definition) => { tabTypes.push(definition); return () => undefined; } },
    remote: { $mount: async () => async () => undefined },
    get: () => undefined,
  };
  return { ctx, factories, registrations, tabTypes, effects, resourceCount: () => resources };
}

/**
 * Run one `apply` under the test document stub.
 *
 * @param {any} context - the stub context.
 * @param {string} [source] - a mutated bundle, for negative controls.
 * @returns {Promise<any>} the loaded module.
 */
async function applyOnce(context, source) {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({ setAttribute: () => undefined, remove: () => undefined, textContent: '' }),
    head: { appendChild: () => undefined },
  };
  try {
    const { mod } = loadBundle(source === undefined ? {} : { source });
    await mod.apply(context);
    return mod;
  } finally {
    globalThis.document = previousDocument;
  }
}

describe('kdocs.workspace：注册契约', () => {
  it('apply 以固定名字与 root scope 注册工厂', async () => {
    const harness = applyContext();
    const mod = await applyOnce(harness.ctx);
    assert.equal(mod.KDOCS_WORKSPACE_FACTORY, 'kdocs.workspace');
    assert.equal(harness.factories.length, 1, '只注册一次');
    assert.deepEqual(harness.factories[0], { name: 'kdocs.workspace', scope: 'root' });
    assert.ok(harness.effects.includes('kdocs: main-workspace factory'));
  });

  it('旧宿主没有 slots.registerFactory 时跳过工厂，右栏照常完整注册', async () => {
    const harness = applyContext({ factoryApi: false });
    const mod = await applyOnce(harness.ctx);
    assert.equal(mod.KDOCS_WORKSPACE_FACTORY, 'kdocs.workspace', '契约名仍导出，消费端可自行 fallback');

    assert.equal(harness.factories.length, 0, '没有 Factory API 就不注册工厂');
    assert.equal(harness.effects.includes('kdocs: main-workspace factory'), false, '连注册效果都没有');

    // 原右栏：两个页签类型、两个页签体、两个标题、配置页、资源协议都还在。
    const registered = harness.registrations.map((entry) => `${entry.name}:${entry.key}`);
    for (const label of [
      'sidebar.right.pane.tab:kdocs',
      'sidebar.right.pane.tab:kdocs-preview',
      'sidebar.right.pane.tab.title:kdocs',
      'sidebar.right.pane.tab.title:kdocs-preview',
      'plugins.bundle.config:dsh-kdocs-inside',
      'conversation.user.text.node:kdocs-reference',
    ]) assert.ok(registered.includes(label), `缺 ${label}`);
    assert.equal(harness.tabTypes.length, 2, '两种页签类型都注册');
    assert.equal(harness.resourceCount(), 1, '资源协议仍注册');
  });

  it('负向对照：删掉能力守卫后，旧宿主 apply 会失败', async () => {
    const unguarded = SOURCE.replace("if (typeof ctx.slots?.registerFactory === 'function') {", 'if (true) {');
    assert.notEqual(unguarded, SOURCE, '负向对照确实改到了源码');
    const harness = applyContext({ factoryApi: false });
    await assert.rejects(() => applyOnce(harness.ctx, unguarded), /registerFactory/);
  });

  it('负向对照：把预览路由删掉后，点击文件不再进入预览', async () => {
    const broken = SOURCE.replace("              setRoute({ view: 'preview', address });", '              /* missing route */');
    assert.notEqual(broken, SOURCE, '负向对照确实改到了源码');
    const { mod, render } = loadBundle({ source: broken });
    const remote = {
      listSorted: async (parent) => ({ ok: true, value: { entries: [FILE] } }),
      read: async () => ({ ok: true, value: { content: 'x' } }),
    };
    const View = mod.createKDocsWorkspace({
      t: (key) => key, remote, workspaceFiles: { stat: async () => ({ ok: true }) },
      sessionSource: { get: () => 'S1', subscribe: () => () => {} },
      insertReference: () => true, openResource: () => {}, openTab: () => {},
    });
    const find = (pred) => findAll(render(View, {}), pred);
    find(() => false);
    await sleep(10);
    find((n) => n.props?.['data-kdocs-row'] === 'file')[0].props.onClick();
    const kind = find((n) => n.props?.['data-kdocs-workspace'] !== undefined)[0]?.props['data-kdocs-workspace'];
    assert.equal(kind, 'browse', '删掉路由后仍停在浏览');
  });
});
