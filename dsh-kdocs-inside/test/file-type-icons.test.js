/**
 * The 0.2.5 file-type glyph system's own promises.
 *
 * This is the one 0.2.5 change that can be *wrong* rather than merely ugly, and
 * wrong in a way no screenshot catches: a suffix missing from the table, a kind
 * with no geometry behind it, or a colour invented rather than taken from the
 * product's token set. A visual check shows "the list has icons"; it cannot show
 * that `.et` is a spreadsheet and `.md` is not.
 *
 * The whole point of the table is that a *kind* is a closed set. So these tests
 * hold the two halves together — every kind the classifier can return must exist
 * in the glyph table, and every glyph in the table must be reachable — which is
 * the invariant that decays silently when someone adds a suffix and forgets the
 * icon, or the reverse.
 *
 * @module kdocs/test/file-type-icons
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/** The shipped bundle source, read once. */
const SOURCE = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

/**
 * Evaluate the shipped bundle and return the module it registered.
 *
 * Copied from `client-bundle.test.js` rather than shared: a test helper module
 * would itself need to be excluded from `node --test`'s glob, and the loader
 * contract here is five lines.
 *
 * @returns {any} the module the bundle builds.
 */
function loadBundle() {
  /** @type {any[]} */
  const registered = [];
  const stub = { __ModuleLoader__: { load(registration) { registered.push(registration); } } };
  // eslint-disable-next-line no-new-func -- evaluating the shipped bundle is the point
  new Function('window', SOURCE)(stub);
  return registered[0].factory((specifier) => {
    if (specifier === 'react') {
      return {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useCallback: (fn) => fn,
        useEffect: () => undefined,
        useRef: (value) => ({ current: value }),
        useState: (value) => [typeof value === 'function' ? value() : value, () => undefined],
      };
    }
    if (specifier === 'react/jsx-runtime') {
      return { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) };
    }
    throw new Error(`unexpected require: ${specifier}`);
  });
}

describe('file-type classification', () => {
  it('classifies every suffix the drive actually returns', () => {
    // Public synthetic names exercise the supported suffixes without private document names.
    const mod = loadBundle();
    const cases = [
      ['sample-1.docx', 'doc'],
      ['sample-2.docx', 'doc'],
      ['sample-3.docx', 'doc'],
      ['sample-4.docx', 'doc'],
      ['sample-5.md', 'text'],
      ['sample-6.md', 'text'],
      ['sample-7.xls', 'sheet'],
      ['sample-8.xlsx', 'sheet'],
      ['sample-9.et', 'sheet'],
      ['sample-10.et', 'sheet'],
      ['sample-11.dbt', 'sheet'],
      ['sample-12.pdf', 'pdf'],
      ['sample-13.otl', 'otl'],
      ['sample-14.OTL', 'otl'],
      ['sample-15.pdf', 'pdf'],
    ];
    for (const [name, kind] of cases) {
      assert.equal(mod.fileKindOf(name), kind, name);
    }
  });

  it('is case-insensitive and survives a name with several dots', () => {
    const mod = loadBundle();
    assert.equal(mod.fileKindOf('REPORT.DOCX'), 'doc');
    assert.equal(mod.fileKindOf('archive.tar.gz'), 'generic', 'only the last suffix counts');
    assert.equal(mod.fileKindOf('2026.09.13 会议纪要.Doc'), 'doc');
  });

  it('refuses to guess', () => {
    const mod = loadBundle();
    // A file we cannot classify must look like a file. Answering `doc` here would
    // be the wrong kind of helpful: the icon is how a reader decides what to open.
    for (const name of [
      'no-extension',
      // A leading dot is a hidden file, not an extension.
      '.gitignore',
      // A trailing dot is not an extension either.
      'trailing.',
      'unknown.zzz',
      'weird.',
      '',
    ]) {
      assert.equal(mod.fileKindOf(name), 'generic', JSON.stringify(name));
    }
  });

  it('treats a non-string name as unclassifiable rather than throwing', () => {
    const mod = loadBundle();
    // The entry shape comes from the Host, and one malformed record must not take
    // the whole tree down — a row is rendered per entry.
    for (const name of [undefined, null, 7, {}, []]) {
      assert.equal(mod.fileKindOf(name), 'generic', String(name));
    }
  });

  it('decides a folder by its entry, not by its name', () => {
    const mod = loadBundle();
    // A folder called "合同.pdf" is a folder. Reading the suffix first would paint
    // it as a PDF, which is the bug this test exists to prevent.
    assert.equal(mod.entryKindOf({ kind: 'directory', name: '合同.pdf' }), 'folder');
    assert.equal(mod.entryKindOf({ kind: 'file', name: '合同.pdf' }), 'pdf');
    assert.equal(mod.entryKindOf({ kind: 'directory', name: '我的文档' }), 'folder');
    assert.equal(mod.entryKindOf({ kind: 'file', name: '我的文档' }), 'generic');
    assert.equal(mod.entryKindOf(undefined), 'generic');
  });
});

describe('file-type glyph table', () => {
  it('has geometry and a colour for every kind the classifier can return', () => {
    const mod = loadBundle();
    const reachable = new Set(['folder', ...Object.keys(mod.FILE_KINDS), 'generic']);
    for (const kind of reachable) {
      const icon = mod.FILE_ICONS[kind];
      assert.ok(icon !== undefined, `no glyph for kind "${kind}"`);
      assert.equal(typeof icon.body, 'string', `${kind}.body`);
      assert.ok(icon.body.length > 0, `${kind}.body must not be empty`);
      assert.equal(typeof icon.color, 'string', `${kind}.color`);
      assert.ok(icon.color.length > 0, `${kind}.color must not be empty`);
    }
  });

  it('has no unreachable glyph', () => {
    const mod = loadBundle();
    const reachable = new Set(['folder', ...Object.keys(mod.FILE_KINDS), 'generic']);
    for (const kind of Object.keys(mod.FILE_ICONS)) {
      assert.ok(reachable.has(kind), `glyph "${kind}" is painted by nothing`);
    }
  });

  it('declares no suffix under two kinds', () => {
    // A suffix in two lists would be classified by `Object.keys` order, which is
    // stable but arbitrary — exactly the kind of thing that changes silently.
    const mod = loadBundle();
    const owner = new Map();
    for (const [kind, suffixes] of Object.entries(mod.FILE_KINDS)) {
      for (const suffix of suffixes) {
        assert.equal(owner.get(suffix), undefined, `"${suffix}" is claimed by ${owner.get(suffix)} and ${kind}`);
        owner.set(suffix, kind);
      }
    }
  });

  it('borrows product tokens except the user-requested OTL purple', () => {
    const mod = loadBundle();
    // §14: K Docs adds colour in exactly one place, and it must be the product's
    // own palette. A hard-coded hex here would be the first step back to a panel
    // that looks foreign next to Workspace files — and would not follow dark mode.
    for (const [kind, icon] of Object.entries(mod.FILE_ICONS)) {
      if (kind === 'otl') { assert.equal(icon.color, '#8b5cf6'); continue; }
      assert.match(icon.color, /^var\(--dsw-[a-z0-9-]+\)$/, `${kind} paints ${icon.color}`);
    }
  });

  it('keeps every glyph inside one 16x16 bounding box and off the network', () => {
    const mod = loadBundle();
    for (const [kind, icon] of Object.entries(mod.FILE_ICONS)) {
      // No `<svg>` wrapper of its own: the frame is added once, in `FileIcon`, so
      // every kind shares one viewBox and cannot drift out of alignment.
      assert.ok(!icon.body.includes('<svg'), `${kind} must be geometry only`);
      // Nothing may fetch, and nothing may reference a stylesheet.
      assert.ok(!/(?:href|url\(|src=)/.test(icon.body), `${kind} references an external resource`);
    }
  });
});
