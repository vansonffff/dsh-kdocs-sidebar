/**
 * The package manifest's own promises.
 *
 * Two real failures motivated this file, neither of which any other test or
 * `npm pack` could see:
 *
 * 1. An `exports` subpath (`./remote`) pointed at `src/remote.js`, a file that
 *    was never created. Importing it is an `ERR_MODULE_NOT_FOUND` at load time,
 *    and a dangling export is not something a packaging dry-run reports.
 * 2. `typert.host.js` imports `zod` directly, but the manifest declared it
 *    neither as a dependency nor as a peer. It resolved only because a
 *    hand-made symlink happened to sit in `node_modules` — so the plugin ran on
 *    this machine and would have failed on a clean one.
 *
 * Both checks are deliberately **static**. This machine's `npm` is unusable
 * (`~/.npm` ownership is broken, so `npm view`/`npm install` cannot run), which
 * means a check that needed an install to notice a missing declaration would
 * never have run here at all.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The parsed manifest under test. */
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));

/** Node builtins are resolved by the runtime, never by the manifest. */
const BUILTIN = /^node:/;

/**
 * Every `.js` file this package ships or runs, as paths relative to the root.
 *
 * `client.js` is included even though it is a classic script: it is scanned for
 * ESM syntax only, and it contains none, so it contributes nothing rather than
 * producing a false positive from its `require(...)` calls — those name modules
 * the browser loader seeds, not npm packages.
 *
 * @param {string} dir - directory to walk, relative to the package root.
 * @returns {string[]} relative file paths.
 */
function walk(dir) {
  const found = [];
  for (const name of readdirSync(join(PACKAGE_ROOT, dir))) {
    const relative = `${dir}/${name}`;
    if (statSync(join(PACKAGE_ROOT, relative)).isDirectory()) found.push(...walk(relative));
    else if (name.endsWith('.js')) found.push(relative);
  }
  return found;
}

/**
 * Collect the bare module specifiers one source file imports.
 *
 * The patterns are anchored to the start of a statement rather than matching
 * `from '…'` anywhere. A loose version of this scan matched the prose inside
 * this very file's comments and strings, which is how a manifest check ends up
 * reporting a package that nobody imports.
 *
 * @param {string} relative - path relative to the package root.
 * @returns {string[]} specifiers, unresolved.
 */
function bareImportsOf(relative) {
  const source = readFileSync(join(PACKAGE_ROOT, relative), 'utf8');
  const patterns = [
    /^[ \t]*import[ \t][^\n]*?from[ \t]*'([^']+)'/gm,
    /^[ \t]*import[ \t]*'([^']+)'/gm,
    /^[ \t]*export[ \t][^\n]*?from[ \t]*'([^']+)'/gm,
    /(?:^|[^\w.$])import[ \t]*\([ \t]*'([^']+)'/gm,
  ];
  const specifiers = [];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier.startsWith('.') || specifier.startsWith('/')) continue;
      if (BUILTIN.test(specifier)) continue;
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

/**
 * The package name a specifier belongs to, scoped names included.
 *
 * @param {string} specifier - an unresolved bare specifier.
 * @returns {string} the installable package name.
 */
function packageNameOf(specifier) {
  const segments = specifier.split('/');
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

/** The files that must resolve from `dependencies` or `peerDependencies`. */
const RUNTIME_FILES = ['client.js', 'typert.host.js', 'typert.remote-client.js', ...walk('src')];

/** The files that may resolve from `devDependencies` as well. */
const TEST_FILES = walk('test');

describe('package manifest', () => {
  it('exports only subpaths that exist', () => {
    const declared = Object.entries(manifest.exports ?? {});
    assert.ok(declared.length > 0, 'the manifest must declare exports');
    for (const [subpath, target] of declared) {
      const file = typeof target === 'string' ? target : target.default;
      assert.ok(typeof file === 'string', `exports["${subpath}"] must name a file`);
      assert.ok(
        existsSync(join(PACKAGE_ROOT, file)),
        `exports["${subpath}"] points at ${file}, which does not exist`,
      );
    }
  });

  it('ships every file the exports name', () => {
    // `files` decides what `npm pack` includes; an export naming a path outside
    // it yields a package that installs and then fails to import.
    const shipped = manifest.files ?? [];
    assert.ok(shipped.includes('src'), 'the runtime sources must be shipped');
    for (const name of ['client.js', 'typert.host.js', 'typert.remote-client.js', 'cordis.patch.yml']) {
      assert.ok(shipped.includes(name), `${name} is exported or mounted but not in "files"`);
    }
  });

  it('declares every package its runtime imports name', () => {
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]);
    const missing = new Set();
    for (const file of RUNTIME_FILES) {
      for (const specifier of bareImportsOf(file)) {
        const name = packageNameOf(specifier);
        if (!declared.has(name)) missing.add(`${name} (imported by ${file})`);
      }
    }
    assert.deepEqual(
      [...missing].sort(),
      [],
      'these packages are imported at runtime but declared nowhere — an install on a clean machine would fail',
    );
  });

  it('declares every package its tests import', () => {
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ]);
    const missing = new Set();
    for (const file of TEST_FILES) {
      for (const specifier of bareImportsOf(file)) {
        const name = packageNameOf(specifier);
        if (!declared.has(name)) missing.add(`${name} (imported by ${file})`);
      }
    }
    assert.deepEqual(
      [...missing].sort(),
      [],
      'these packages are imported by tests but declared nowhere',
    );
  });

  it('runs both scripts the delivery promise names', () => {
    // `npm test` must stay runnable without an account; `npm run test:live` is
    // the gate that fails when one is missing. Losing either is a silent change
    // to what "the tests pass" means.
    assert.equal(typeof manifest.scripts?.test, 'string');
    assert.match(String(manifest.scripts['test:live']), /KDOCS_LIVE=require/);
  });
});
