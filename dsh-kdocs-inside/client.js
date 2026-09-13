/**
 * Browser (Client) bundle for the `kdocs` plugin.
 *
 * Its single job is to mount this package's Remote contribution, so that
 * `ctx.remote.kdocs` exists for any client plugin that injects it — including
 * the right-sidebar browser and preview tabs planned for M5/M6.
 *
 * The bundle is a **hand-written client module**, not a build artifact: DSH's
 * `dsh-client-modules` loads whatever `exports["./client"]` points at through
 * `window.__ModuleLoader__.load({ id, factory })`, and there is no bundler in
 * this profile to compile a source tree. That is why the factory body imports
 * nothing and the descriptors are inlined below rather than imported from
 * `./typert.remote-client.js` — a browser `require` can only resolve modules
 * that are themselves registered in the client graph.
 *
 * Keep the inlined table in sync with `src/remote-invocations.js`; the
 * `remote contract` unit test asserts that it is.
 *
 * @module kdocs/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-kdocs-inside',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const react = require('react');
    const jsxRuntime = require('react/jsx-runtime');
    const { jsx, jsxs } = jsxRuntime;
    const { useCallback, useEffect, useRef, useState } = react;

    // ── the shared design vocabulary ────────────────────────────────────────
    //
    // Declared before anything that reads them. The panel and the preview sit in
    // the same column and must not drift apart, so they read one scale and one
    // control geometry rather than two that happen to agree today.
    /**
     * The panel's spacing scale.
     *
     * Every gap in this panel was previously its own number (`4` here, `6` there,
     * `5px 9px` on a menu item), which is what makes a surface read as assembled
     * rather than designed. 0.2.5 replaces those with six steps; a value that is
     * not on the scale is a mistake, not a preference.
     *
     * The row metrics are the product's own, read off the live sidebar
     * (`projectRow`: `8px` radius, `0 8px` padding, `6px` gap, 34px tall) rather
     * than invented, so the tree sits at the same rhythm as Workspace files.
     *
     * Both are panel-level (not preview-level) because the *preview's* one-row
     * toolbar reads from the same scale: the two surfaces sit in the same column,
     * and a single scale is the only thing that keeps them agreeing.
     */
    const SPACE = {
      xxs: '2px',
      xs: '4px',
      sm: '6px',
      md: '8px',
      lg: '12px',
      xl: '16px',
    };
    /** The same six steps under the name the preview toolbar reads them by. */
    const PANEL_SPACE = SPACE;

    /**
     * The one geometry every control in the preview header uses.
     *
     * The four controls used to carry two different geometries — the mode pair at
     * 11.5px / `2px 8px` / 5px radius, and quote plus "open in 金山文档" at
     * 12px / `3px 9px` / 6px — which reads as two unrelated toolbars stacked in
     * one row. Everything that decides a control's box is pinned here so the row
     * is uniform by construction rather than by four styles happening to agree.
     *
     * `font: inherit` is not optional: a `<button>` does not inherit the page font
     * and falls back to the browser's UI font, which is how a control announces
     * itself as foreign. `lineHeight`, `boxSizing` and `border` are pinned for the
     * same reason on the anchor, which is a flex item here and would otherwise sit
     * a pixel or two off the buttons beside it.
     *
     * The padding is on the spacing scale, and the height is derived from it rather
     * than declared: the toolbar's box is `lineHeight + padding + border` = 25px,
     * which is what 0.2 measured at. Pinning it that way keeps the row's total
     * height identical while letting the horizontal padding shrink to 6px, which is
     * the 0.2.5 change — narrower controls, same row.
     */
    const HEADER_ACTION_STYLE = {
      font: 'inherit',
      fontSize: '12px',
      lineHeight: '18px',
      padding: `${SPACE.xxs} ${SPACE.sm}`,
      boxSizing: 'border-box',
      border: '0.5px solid var(--dsw-alias-border-l3)',
      borderRadius: '6px',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      flex: '0 0 auto',
      whiteSpace: 'nowrap',
      textDecoration: 'none',
    };

    // Required browser services: the Remote carrier to mount onto, the resource
    // model this plugin registers its `kdocs` protocol into, the right sidebar's
    // tab registry and keyed seat, and copy. All must exist before activation,
    // so Cordis must not start this plugin first.
    exports.inject = ['remote', 'resources', 'slots', 'locale', 'sidebarRightTabs'];

    const NAMESPACE = 'kdocs';

    /**
     * A schema the client does not need to enforce.
     *
     * The Host validates every parameter and produces every result through its
     * own generated schemas, so a permissive client schema costs no safety and
     * keeps zod out of the browser bundle.
     *
     * @returns {{ parse: (value: unknown) => unknown }} passthrough schema.
     */
    const passthrough = () => ({ parse: (value) => value });

    /**
     * Business parameters per method, in declaration order.
     *
     * `cancellable` mirrors the Host's trailing `signal` parameter, which the
     * Gateway appends rather than treating as a business argument. `implementation`
     * mirrors the Host alias the strict dispatcher invokes; the Client does not
     * dispatch with it, but keeping both faces field-identical is what lets the
     * drift test compare them directly.
     *
     * @type {{ method: string, implementation: string, parameters: { name: string, optional?: boolean }[], cancellable: boolean }[]}
     */
    const INVOCATIONS = [
      { method: 'status', implementation: 'remoteStatus', parameters: [], cancellable: true },
      {
        method: 'list',
        implementation: 'remoteList',
        parameters: [
          { name: 'parent', optional: true },
          { name: 'cursor', optional: true },
        ],
        cancellable: true,
      },
      { method: 'listVersions', implementation: 'remoteListVersions', parameters: [{ name: 'ref' }], cancellable: true },
      { method: 'listComments', implementation: 'remoteListComments', parameters: [{ name: 'ref' }], cancellable: true },
      { method: 'rename', implementation: 'remoteRename', parameters: [{ name: 'ref' }, { name: 'newName' }], cancellable: true },
      {
        method: 'listView',
        implementation: 'remoteListView',
        parameters: [
          { name: 'view' },
          { name: 'cursor', optional: true },
        ],
        cancellable: true,
      },
      { method: 'search', implementation: 'remoteSearch', parameters: [{ name: 'query' }, { name: 'cursor', optional: true }, { name: 'options', optional: true }], cancellable: true },
      { method: 'stat', implementation: 'remoteStat', parameters: [{ name: 'ref' }], cancellable: true },
      {
        method: 'read',
        implementation: 'remoteRead',
        parameters: [{ name: 'ref' }, { name: 'options', optional: true }],
        cancellable: true,
      },
      { method: 'getLink', implementation: 'remoteGetLink', parameters: [{ name: 'ref' }], cancellable: true },
    ];

    /** The contribution mounted into the Client Remote. */
    const TYPERT_REMOTE = {
      package: 'kdocs',
      descriptors: INVOCATIONS.map((invocation) => ({
        id: `kdocs#${NAMESPACE}/${invocation.method}`,
        service: NAMESPACE,
        namespace: NAMESPACE,
        method: invocation.method,
        implementation: invocation.implementation,
        invocation: { kind: 'direct' },
        parameters: invocation.parameters.map((parameter) => ({
          name: parameter.name,
          wire: parameter.name,
          source: 'json',
          acceptsUndefined: parameter.optional === true,
          codec: {
            mode: 'strict',
            typeSymbol: `kdocs#${NAMESPACE}/${invocation.method}:${parameter.name}`,
            schema: passthrough(),
          },
        })),
        ...(invocation.cancellable ? { cancellation: { parameter: 'signal' } } : {}),
        result: {
          mode: 'strict',
          typeSymbol: `kdocs/${NAMESPACE}#${invocation.method}:result`,
          schema: passthrough(),
        },
      })),
    };

    // ── the `kdocs` resource protocol ──────────────────────────────────────
    //
    // `dsh-resource://kdocs/file/<driveId>/<fileId>` resolves to metadata only.
    // The body is deliberately absent: a resource snapshot travels through every
    // subscription and re-render, and an extracted report can be hundreds of
    // kilobytes. A Tab fetches the body through `remote.kdocs.read(...)`.
    //
    // This mirrors `src/resource.js`, which cannot be imported here: a browser
    // `require` resolves only modules registered in the client graph. The
    // `resource protocol` unit test drives this copy in Node and asserts the
    // address grammar and framing.

    /** The protocol key, i.e. the host part of every address this serves. */
    const RESOURCE_PROTOCOL = 'kdocs';
    /** The address segment naming a document. */
    const RESOURCE_KIND = 'file';
    /** The one scheme a resource address may use. */
    const RESOURCE_SCHEME = 'dsh-resource:';
    /** Opaque backend ids: URL-safe, never containing a slash. */
    const IDENTIFIER = /^[A-Za-z0-9_-]+$/;

    /**
     * Build the address of one document (mirror of `src/resource.js`).
     *
     * @param {any} ref - `{ driveId, fileId }`.
     * @returns {string} the resource address.
     */
    function kdocsAddressOf(ref) {
      if (typeof ref?.driveId !== 'string' || !IDENTIFIER.test(ref.driveId)) {
        throw new TypeError('kdocs: driveId is not a usable drive identifier');
      }
      if (typeof ref?.fileId !== 'string' || !IDENTIFIER.test(ref.fileId)) {
        throw new TypeError('kdocs: fileId is not a usable file identifier');
      }
      return `${RESOURCE_SCHEME}//${RESOURCE_PROTOCOL}/${RESOURCE_KIND}/${ref.driveId}/${ref.fileId}`;
    }

    /**
     * Read a Remote result without assuming its shape.
     *
     * The Client API is documented to wrap every call as `{ ok, value }`, and the
     * panel and text preview rely on that. `getLink` nonetheless arrived at the
     * button as something whose `ok` was not `true`, and the cause could not be
     * pinned down from outside the browser — so this accepts **either** shape
     * rather than betting on one. A bare value and a successful envelope are
     * treated alike; only an explicit failure is a failure.
     *
     * @param {any} result - whatever the Remote call resolved to.
     * @returns {{ ok: boolean, value?: any, error?: any }} the normalized result.
     */
    function unwrapResult(result) {
      if (result !== null && typeof result === 'object' && typeof result.ok === 'boolean') {
        return result.ok === true
          ? { ok: true, value: result.value }
          : { ok: false, error: result.error ?? { code: 'unknown', message: 'remote call failed' } };
      }
      // A bare value: the call succeeded and returned its business result directly.
      return { ok: true, value: result };
    }

    /**
     * Parse an address into the document it names.
     *
     * @param {unknown} address - the full address, scheme included.
     * @returns {{ driveId: string, fileId: string } | undefined} the identity, or undefined.
     */
    function parseKDocsAddress(address) {
      if (typeof address !== 'string' || !address.startsWith(RESOURCE_SCHEME)) return undefined;
      let url;
      try {
        url = new URL(address);
      } catch {
        return undefined;
      }
      if (url.hostname !== RESOURCE_PROTOCOL) return undefined;
      const segments = url.pathname.split('/').filter((segment) => segment !== '');
      if (segments.length !== 3) return undefined;
      const [kind, driveId, fileId] = segments;
      if (kind !== RESOURCE_KIND) return undefined;
      if (!IDENTIFIER.test(driveId) || !IDENTIFIER.test(fileId)) return undefined;
      return { driveId, fileId };
    }

    /**
     * Parse a document handle into a locator — the inlined copy of
     * `src/resource.js#parseKDocsLocator`.
     *
     * This bundle cannot import `src/`, so the twin is duplicated and the two are
     * compared by test. It went missing here for exactly one test run, and the
     * symptom was instructive: `toolResultAddress` swallows its own JSON errors, so
     * a missing binding surfaced as "no address found" rather than as a
     * ReferenceError — a silent wrong answer, which is what the drift test below
     * exists to prevent.
     *
     * @param {unknown} text - the candidate handle.
     * @returns {{ ref: { driveId: string, fileId: string } } | { url: string } | undefined} the locator.
     */
    function parseKDocsLocator(text) {
      if (typeof text !== 'string') return undefined;
      const trimmed = text.trim();
      if (trimmed === '') return undefined;

      const ref = parseKDocsAddress(trimmed);
      if (ref !== undefined) return { ref };

      let url;
      try {
        url = new URL(trimmed);
      } catch {
        return undefined;
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
      if (url.hostname !== 'www.kdocs.cn' && url.hostname !== 'kdocs.cn') return undefined;
      if (!/^\/l\/[A-Za-z0-9_-]+$/.test(url.pathname)) return undefined;
      return { url: trimmed };
    }

    /**
     * Narrow one Host entry into the metadata-only resource value.
     *
     * @param {any} entry - the entry `remote.kdocs.stat` returned.
     * @returns {any} the resource value.
     */
    function toResourceValue(entry) {
      const value = {
        driveId: entry.ref.driveId,
        fileId: entry.ref.fileId,
        name: entry.name,
        kind: entry.kind,
      };
      if (entry.extension !== undefined) value.extension = entry.extension;
      if (entry.modifiedAt !== undefined) value.modifiedAt = entry.modifiedAt;
      if (entry.size !== undefined) value.size = entry.size;
      return value;
    }

    /**
     * The failure frame for an address this protocol does not serve.
     *
     * Structurally a `RemoteError` — the `isDSHRemoteError` marker plus a string
     * `code` is how the framework identifies one across realms, which is why the
     * class does not have to be imported (and could not be: `typert-protocol` is
     * not a client-graph module).
     *
     * @param {unknown} address - the offending address.
     * @returns {any} the failure frame.
     */
    function unsupportedAddress(address) {
      return {
        ok: false,
        error: {
          code: 'kdocs-resource/unsupported-address',
          message: `${String(address)} is not a dsh-resource://kdocs/file/<driveId>/<fileId> address`,
          details: { address: String(address) },
          isDSHRemoteError: true,
        },
      };
    }

    /**
     * The `kdocs` protocol's provider.
     *
     * @param {() => any} remote - resolves the Remote face.
     * @returns {any} the provider for `ctx.resources.register`.
     */
    function createKDocsResourceProvider(remote) {
      return {
        protocol: RESOURCE_PROTOCOL,
        /**
         * Resolve one address to a single metadata frame.
         *
         * A failure is always a frame, never a throw: a throw inside the stream
         * is a programming error the resource model lets surface, so turning an
         * expected backend failure into one would crash a Tab.
         *
         * @param {string} address - the full address.
         * @param {any} [openContext] - the resource layer's per-subscription context,
         *   which carries the `AbortSignal` that ends this open when the last
         *   subscriber goes away.
         * @returns {AsyncGenerator<any, void, unknown>} the frame stream.
         */
        async *open(address, openContext) {
          const ref = parseKDocsAddress(address);
          if (ref === undefined) {
            yield unsupportedAddress(address);
            return;
          }
          const signal = openContext === undefined ? undefined : openContext.signal;
          /** @type {any} */
          let result;
          try {
            result = unwrapResult(await remote().stat(ref, signal));
          } catch (error) {
            // A closed subscription is not a failure to report to a Tab.
            if (signal !== undefined && signal.aborted) return;
            yield {
              ok: false,
              error: { code: 'transport', message: String(error && error.message ? error.message : error) },
            };
            return;
          }
          if (result.ok === true) {
            yield { ok: true, value: toResourceValue(result.value) };
            return;
          }
          // The Remote face already carries a business failure in the seam's own
          // vocabulary, so it is forwarded unchanged.
          yield { ok: false, error: result.error };
        },
      };
    }

    // ── the 金山文档 preview tab ────────────────────────────────────────────
    //
    // The other half of M5: the panel emits
    // `dsh-resource://kdocs/file/<driveId>/<fileId>` addresses, and this type
    // *claims* them. `patterns` matches the whole address (a pattern containing
    // `:` is matched against the address, not its path), and `priority:
    // 'extension'` is the highest band, which is correct for a type shipped
    // outside the product.
    //
    // Rendering is deliberately a **semantic** view, not an Office replica: the
    // Host returns extracted Markdown (and slide-structured Markdown for `.pptx`),
    // so the preview shows the document's text and offers a link to 金山文档 for
    // the real thing. A high-fidelity renderer is a later, separate problem.

    /** This preview type's kind, and what the address routes to. */
    const PREVIEW_KIND = 'kdocs-preview';
    /** This implementation's identity, and the key its body registers under. */
    const PREVIEW_ID = 'kdocs-preview';

    /**
     * Parse the Markdown subset the Host emits into renderable blocks.
     *
     * Kept pure and exported so it is testable without a renderer. The subset is
     * what `kdocs-cli` actually produces: headings, bullet and numbered lists,
     * block quotes, tables, horizontal rules, and paragraphs of inline text.
     * Anything unrecognized becomes a paragraph rather than being dropped — a
     * preview that silently loses text is worse than one that shows it plainly.
     *
     * @param {string} markdown - the extracted body.
     * @returns {{ kind: string, level?: number, text?: string, ordered?: boolean, index?: number, rows?: string[][] }[]} blocks.
     */
    function parseMarkdown(markdown) {
      if (typeof markdown !== 'string' || markdown === '') return [];
      const blocks = [];
      const lines = markdown.split(/\r?\n/);
      let paragraph = [];

      const flush = () => {
        if (paragraph.length === 0) return;
        blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
        paragraph = [];
      };

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const trimmed = line.trim();

        if (trimmed === '') {
          flush();
          continue;
        }

        const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
        if (heading !== null) {
          flush();
          blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
          continue;
        }

        if (/^(?:---+|___+|\*\*\*+)$/.test(trimmed)) {
          flush();
          blocks.push({ kind: 'rule' });
          continue;
        }

        // A table: a header row followed by a separator row of dashes and pipes.
        if (trimmed.startsWith('|') && i + 1 < lines.length && /^\|?[\s:|-]+\|?$/.test(lines[i + 1].trim()) && lines[i + 1].includes('-')) {
          const rows = [];
          const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
          rows.push(cells(trimmed));
          i += 2;
          while (i < lines.length && lines[i].trim().startsWith('|')) {
            rows.push(cells(lines[i].trim()));
            i += 1;
          }
          i -= 1;
          flush();
          blocks.push({ kind: 'table', rows });
          continue;
        }

        const bullet = /^([-*+])\s+(.*)$/.exec(trimmed);
        if (bullet !== null) {
          flush();
          blocks.push({ kind: 'listItem', ordered: false, text: bullet[2].trim() });
          continue;
        }

        const numbered = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
        if (numbered !== null) {
          flush();
          blocks.push({ kind: 'listItem', ordered: true, index: Number(numbered[1]), text: numbered[2].trim() });
          continue;
        }

        const quote = /^>\s?(.*)$/.exec(trimmed);
        if (quote !== null) {
          flush();
          blocks.push({ kind: 'quote', text: quote[1].trim() });
          continue;
        }

        paragraph.push(trimmed);
      }
      flush();
      return blocks;
    }

    /**
     * Split inline text into styled spans.
     *
     * The Host's Markdown carries inline emphasis for `.md` sources (a real report
     * had 252 `**…**` runs) and escapes Markdown punctuation for extracted Word
     * text (`\\#`, `\\*`). Both need handling, and they interact: the escape has to
     * be resolved *before* emphasis is scanned, or an escaped `\\*\\*` would open a
     * bold run that never closes.
     *
     * Only `**bold**`, `*italic*`, `` `code` `` and links are recognized. Anything
     * else stays literal text — showing `**` is a much smaller failure than
     * swallowing the words between them.
     *
     * @param {string} text - inline text.
     * @returns {{ text: string, bold?: boolean, italic?: boolean, code?: boolean, href?: string }[]} spans.
     */
    function inlineSpans(text) {
      const source = String(text ?? '').replace(/\\([\\`*_{}\[\]()#+.!|>-])/g, '$1');
      /** @type {{ text: string, bold?: boolean, italic?: boolean, code?: boolean, href?: string }[]} */
      const spans = [];
      let plain = '';
      const flush = () => {
        if (plain === '') return;
        spans.push({ text: plain });
        plain = '';
      };

      // The capture groups keep the delimiters so the source can be rebuilt.
      const pattern = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))/g;
      let last = 0;
      let match;
      while ((match = pattern.exec(source)) !== null) {
        plain += source.slice(last, match.index);
        last = match.index + match[0].length;
        const token = match[0];
        if (match[1] !== undefined) {
          flush();
          spans.push({ text: token.slice(2, -2), bold: true });
        } else if (match[2] !== undefined) {
          flush();
          spans.push({ text: token.slice(1, -1), italic: true });
        } else if (match[3] !== undefined) {
          flush();
          spans.push({ text: token.slice(1, -1), code: true });
        } else {
          const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
          flush();
          const target = safeHref(link[2]);
          // A refused target keeps the label: dropping the whole span would lose
          // text the document actually contains.
          if (target === undefined) spans.push({ text: link[1] });
          else spans.push({ text: link[1], href: target });
        }
      }
      plain += source.slice(last);
      flush();
      return spans;
    }

    /**
     * The href a Markdown link is allowed to carry, or undefined to render it as text.
     *
     * Document bodies are **untrusted input** — a shared or doctored cloud file can
     * contain anything — so the target is parsed and restricted to the two schemes a
     * reader can safely follow. Everything else (`javascript:`, `data:`, `file:`,
     * custom app schemes, a malformed URL) becomes plain text rather than a live
     * link. `rel="noreferrer"` and `target="_blank"` do not help with a scheme the
     * page should never have been asked to open.
     *
     * @param {unknown} href - the target as written in the document.
     * @returns {string | undefined} the href to use, or undefined to drop the link.
     */
    function safeHref(href) {
      if (typeof href !== 'string') return undefined;
      // Control characters and whitespace inside a scheme are how `java\nscript:`
      // slips past a naive prefix check.
      if (/[\u0000-\u001f\u007f]/.test(href)) return undefined;
      let url;
      try {
        url = new URL(href);
      } catch {
        return undefined;
      }
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
    }

    /**
     * Render inline spans, keeping the escape resolution and emphasis intact.
     *
     * @param {string} text - inline text.
     * @param {string} keyPrefix - React key prefix for this run.
     * @returns {any} a single node, or an array when the text carries emphasis.
     */
    function renderInline(text, keyPrefix) {
      const spans = inlineSpans(text);
      if (spans.length === 0) return '';
      // One unstyled span is the common case for extracted Word text; returning
      // the bare string keeps the DOM free of a pointless wrapper per line.
      if (spans.length === 1 && spans[0].bold !== true && spans[0].italic !== true && spans[0].code !== true && spans[0].href === undefined) {
        return spans[0].text;
      }
      return spans.map((span, index) => {
        const key = `${keyPrefix}-${String(index)}`;
        if (span.href !== undefined) {
          return jsx('a', { key: key, href: span.href, target: '_blank', rel: 'noreferrer', style: { color: 'inherit' }, children: span.text });
        }
        if (span.code === true) {
          return jsx('code', {
            key: key,
            style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.92em', background: 'transparent', padding: '0 3px', borderRadius: '3px' },
            children: span.text,
          });
        }
        if (span.bold === true || span.italic === true) {
          return jsx('span', {
            key: key,
            style: { fontWeight: span.bold === true ? 600 : undefined, fontStyle: span.italic === true ? 'italic' : undefined },
            children: span.text,
          });
        }
        return jsx('span', { key: key, children: span.text });
      });
    }

    /**
     * Render the parsed blocks.
     *
     * @param {any[]} blocks - blocks from {@link parseMarkdown}.
     * @returns {any[]} React children.
     */
    function renderBlocks(blocks) {
      const out = [];
      let listRun = null;
      const flushList = () => {
        if (listRun === null) return;
        out.push(jsx('ul', { key: `list-${String(out.length)}`, style: { margin: '4px 0', paddingLeft: '20px' }, children: listRun }));
        listRun = null;
      };

      for (let i = 0; i < blocks.length; i += 1) {
        const block = blocks[i];
        if (block.kind === 'listItem') {
          const item = jsx('li', { key: `li-${String(i)}`, style: { margin: '1px 0' }, children: renderInline(block.text, `li-${String(i)}`) });
          if (listRun === null) listRun = [];
          listRun.push(item);
          continue;
        }
        flushList();

        if (block.kind === 'heading') {
          const size = Math.max(13, 19 - block.level);
          out.push(jsx('div', {
            key: `h-${String(i)}`,
            style: { fontSize: `${String(size)}px`, fontWeight: 600, margin: '10px 0 4px' },
            children: renderInline(block.text, `h-${String(i)}`),
          }));
        } else if (block.kind === 'rule') {
          out.push(jsx('hr', { key: `hr-${String(i)}`, style: { border: 'none', borderTop: '0.5px solid var(--dsw-alias-border-l3)', margin: '10px 0' } }));
        } else if (block.kind === 'quote') {
          out.push(jsx('div', {
            key: `q-${String(i)}`,
            style: { borderLeft: '2px solid var(--dsw-alias-border-l3)', paddingLeft: '8px', opacity: 0.85, margin: '4px 0' },
            children: renderInline(block.text, `q-${String(i)}`),
          }));
        } else if (block.kind === 'table') {
          const rows = block.rows.map((cells, rowIndex) => jsx('tr', {
            key: `tr-${String(rowIndex)}`,
            children: cells.map((cell, cellIndex) => jsx(rowIndex === 0 ? 'th' : 'td', {
              key: `td-${String(cellIndex)}`,
              style: { border: '0.5px solid var(--dsw-alias-border-l3)', padding: '3px 6px', textAlign: 'left', fontWeight: rowIndex === 0 ? 600 : 400 },
              children: renderInline(cell, `cell-${String(i)}-${String(cellIndex)}`),
            })),
          }));
          out.push(jsx('table', { key: `t-${String(i)}`, style: { borderCollapse: 'collapse', margin: '6px 0', fontSize: '12.5px' }, children: jsx('tbody', { children: rows }) }));
        } else {
          out.push(jsx('div', { key: `p-${String(i)}`, style: { margin: '4px 0', lineHeight: 1.7 }, children: renderInline(block.text, `p-${String(i)}`) }));
        }
      }
      flushList();
      return out;
    }

    /**
     * The preview definition: claims this plugin's own resource addresses.
     *
     * @param {any} t - namespace-bound translate.
     * @returns {any} the definition.
     */
    function kdocsPreviewDefinition(t) {
      return {
        id: PREVIEW_ID,
        kind: PREVIEW_KIND,
        patterns: ['dsh-resource://kdocs/file/**'],
        priority: 'extension',
        title: (address) => kdocsNameOfAddress(address) ?? t('previewFallbackTitle'),
      };
    }

    /**
     * The embedded viewer URL for one document.
     *
     * Built from identity rather than from `getLink`, for two reasons: the share
     * link is not needed to view a document the session can already open, and
     * using identity keeps the preview free of any sharing surface. The `?f=`
     * segment is the WPS viewer's own file reference.
     *
     * The viewer honors the browser's existing 金山文档 session, which is what
     * makes this work inside the DSH page — and what makes the text mode a
     * necessary fallback when that session is gone.
     *
     * @param {{ driveId: string, fileId: string }} ref - the document identity.
     * @returns {string} the viewer URL.
     */
    function kdocsEmbedUrl(ref) {
      return `https://www.kdocs.cn/l/${ref.fileId}?f=${ref.driveId}`;
    }

    /**
     * The document name an address carries, when it decodes.
     *
     * The address holds ids, not a name, so this is only a last-resort chip label;
     * the body replaces it with the real name from the resource value.
     *
     * @param {string} address - the resource address.
     * @returns {string | undefined} the file id, or undefined when unparseable.
     */
    function kdocsNameOfAddress(address) {
      const ref = parseKDocsAddress(address);
      return ref === undefined ? undefined : ref.fileId;
    }

    /**
     * The preview body.
     *
     * Reads metadata through the standard `useResource` hook (the value M4
     * publishes) and the body through `remote.kdocs.read`, then renders the
     * extracted Markdown. A failure is shown in place, never thrown: a preview
     * that blanks out on a backend hiccup is worse than one that says what went
     * wrong.
     *
     * @param {any} props - seat props.
     * @returns {any} the rendered preview.
     */
    function KDocsPreview(props) {
      const { t, useTabInfo, useResource } = props;
      const { tab } = useTabInfo();
      const address = tab.contentId;
      // Every derived value is declared once, in dependency order, before any
      // reader. Two rounds of this were broken by inserting a reader above its
      // source: first `openHref` read `ref`, then `embedding` read `mode`. Each
      // threw during render and left the whole pane empty.
      const ref = parseKDocsAddress(address);
      const [mode, setMode] = useState('embed');
      /**
       * Bumped to force the embed to load again.
       *
       * A reader who has just signed the web session in needs the document
       * re-requested: the frame already decided it was signed out, and nothing here
       * can reach into a cross-origin document to change its mind. Changing the
       * element's `key` is what remounts it.
       */
      const [nonce, setNonce] = useState(0);
      /** The embedded WPS viewer's URL, built from identity. */
      const embedUrl = ref === undefined ? undefined : kdocsEmbedUrl(ref);
      const embedding = mode === 'embed' && embedUrl !== undefined;
      // `useResource` is a global standard prop the resource model contributes to
      // every slot component. It is optional here on purpose: when it is absent the
      // preview still works, because the header name and the embed URL both come
      // from the address and the read result. Calling it unconditionally is what
      // emptied the whole pane — a throw inside a slot body is swallowed, leaving
      // only an empty frame with no explanation.
      const meta = typeof useResource === 'function' ? useResource(address) : undefined;
      const [doc, setDoc] = useState({ loading: true, content: undefined, format: undefined, truncated: false, error: undefined });
      /** The text currently selected in the reader, and where to float its button. */
      const [selection, setSelection] = useState(undefined);
      const signal = tab.signal;

      useEffect(() => {
        const ref = parseKDocsAddress(address);
        if (ref === undefined) {
          setDoc({ loading: false, content: undefined, format: undefined, truncated: false, error: { message: t('unsupportedAddress') } });
          return undefined;
        }
        let cancelled = false;
        void (async () => {
          try {
            // The tab's own signal rides along: closing the tab must stop the
            // extraction, not merely stop this component from reading it.
            const result = unwrapResult(await props.remote.read(ref, {}, signal));
            if (cancelled) return;
            if (result.ok === true) {
              setDoc({
                loading: false,
                content: result.value?.content ?? '',
                format: result.value?.format,
                truncated: result.value?.truncated === true,
                error: undefined,
              });
            } else {
              setDoc({ loading: false, content: undefined, format: undefined, truncated: false, error: result.error ?? { message: t('readFailed') } });
            }
          } catch (error) {
            // An aborted read is the tab closing, not a failure to report.
            if (cancelled || signal.aborted) return;
            setDoc({ loading: false, content: undefined, format: undefined, truncated: false, error: { message: String(error && error.message ? error.message : error) } });
          }
        })();
        return () => {
          cancelled = true;
        };
        // `signal` is deliberately NOT a dependency. It was added here and
        // immediately produced a second `read-file` for the same address eight
        // seconds apart: the tab's signal is not referentially stable, so listing it
        // re-ran the effect and re-issued the extraction. What identifies the work
        // is `address`, and the signal captured for that address stays valid for as
        // long as the tab that owns it.
      }, [address, props, t]);

      const name = meta?.value?.name ?? kdocsNameOfAddress(address) ?? '';
      /** Where "open in 金山文档" goes. The same verified identity URL the embed uses. */
      const openHref = ref === undefined ? undefined : kdocsEmbedUrl(ref);

      // Quote-into-the-conversation.
      //
      // This seat is session-scoped, so `inputActions` and `useInput` arrive as
      // standard props and the write is a direct call. The connectors that keep
      // their browser in a root-scoped settings page cannot do this and have to
      // register a null-rendering bridge entry purely to reach the composer; that
      // hop, and its failure mode (the bridge is absent, so quoting silently
      // degrades to a text box), is not needed here.
      const draft = typeof props.useInput === 'function'
        ? props.useInput((input) => (input !== null && typeof input === 'object' && typeof input.draft === 'string' ? input.draft : ''))
        : '';
      const canQuote = typeof props.inputActions?.setDraft === 'function';
      /** Write one marker into the composer, keeping whatever is already typed. */
      const writeMarker = (marker) => {
        const current = typeof draft === 'string' ? draft.trim() : '';
        // Appending keeps what the user already typed: quoting twice must not
        // silently drop the first document.
        props.inputActions.setDraft(current === '' ? marker : `${current}\n\n${marker}`);
      };
      const quote = () => writeMarker(kdocsQuoteMarker(name, address));

      /**
       * Offer to quote the passage the reader just selected.
       *
       * The coordinates are clamped to the viewport: a selection near the right or
       * bottom edge would otherwise put the button off-screen, where it looks like
       * nothing happened at all.
       */
      const onReaderMouseUp = (event) => {
        if (!canQuote) return;
        let text = '';
        try {
          text = String(window.getSelection?.()?.toString() ?? '').trim();
        } catch {
          text = '';
        }
        if (text === '') {
          setSelection(undefined);
          return;
        }
        const x = Math.min(Math.max(Number(event?.clientX ?? 0) - 40, 8), Math.max(window.innerWidth - 150, 8));
        const y = Math.max(Number(event?.clientY ?? 0) - 40, 8);
        setSelection({ text, x, y });
      };

      /** Quote just the selected passage; the handle still identifies the document. */
      const quoteSelection = () => {
        if (selection === undefined) return;
        writeMarker(kdocsQuoteMarker(name, address, selection.text));
        setSelection(undefined);
      };

      const modeButton = (value, label) => jsx('button', {
        key: `mode-${value}`,
        type: 'button',
        'data-kdocs-mode': value,
        'aria-pressed': mode === value ? 'true' : 'false',
        onClick: () => setMode(value),
        style: {
          ...HEADER_ACTION_STYLE,
          // A segment carries no border of its own — the group draws the one outline
          // — and the selection is carried by fill and weight rather than by size, so
          // the active control does not change the row's geometry when it moves.
          border: 0,
          borderRadius: 0,
          background: mode === value ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
          fontWeight: mode === value ? 500 : 400,
          opacity: mode === value ? 1 : 0.72,
        },
        children: label,
      });

      // The four controls are two different kinds of thing, and 0.2.5 says so in the
      // layout: 原版/文本 are one segmented control (a view mode, one choice), while
      // 引用到对话 and 在金山文档打开 stay independent actions. Grouping the pair under
      // a single outline is also what buys back the width a narrow sidebar needs —
      // two 0.5px borders and a 1px seam instead of two borders and an 8px gap.
      const modeGroup = jsxs('div', {
        key: 'modeGroup',
        role: 'group',
        'data-kdocs-mode-group': 'true',
        style: {
          display: 'flex',
          alignItems: 'center',
          flex: '0 0 auto',
          border: '0.5px solid var(--dsw-alias-border-l3)',
          borderRadius: '6px',
          overflow: 'hidden',
        },
        children: [
          modeButton('embed', t('modeEmbed')),
          jsx('span', { key: 'seam', 'aria-hidden': 'true', style: { flex: 'none', width: '0.5px', height: '12px', background: 'var(--dsw-alias-border-l3)' } }),
          modeButton('text', t('modeText')),
        ],
      });

      const header = jsxs('div', {
        key: 'header',
        style: { display: 'flex', alignItems: 'center', gap: PANEL_SPACE.sm, padding: `${PANEL_SPACE.md} ${PANEL_SPACE.md}`, borderBottom: '0.5px solid var(--dsw-alias-border-l3)', flex: '0 0 auto' },
        children: [
          jsx('div', { key: 'name', style: { flex: '1 1 auto', minWidth: 0, fontSize: '12.5px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: name }),
          modeGroup,
          // Reload belongs to the embedded view, so it is hidden in text mode, where
          // the extraction is authenticated by the kdocs-cli token instead.
          //
          // The sign-in page that used to sit beside it was removed on the reader's
          // instruction (0.2.5). See MILESTONE-0.2.5-UI-POLISH.md for what it did and
          // how to bring it back — this reload control survives it, and is still the
          // only way to re-mount a cross-origin frame whose session changed under it.
          embedding
            ? jsx('button', {
              key: 'embedReload',
              type: 'button',
              'data-kdocs-embed-reload': 'true',
              onClick: () => setNonce((current) => current + 1),
              // An icon, because the row already carries several labels and the name
              // is the only thing that can give up width.
              title: t('embedReload'),
              style: HEADER_ACTION_STYLE,
              children: '↻',
            })
            : null,
          canQuote
            ? jsx('button', {
              key: 'quote',
              type: 'button',
              'data-kdocs-quote': 'true',
              onClick: quote,
              title: t('quoteHint'),
              style: HEADER_ACTION_STYLE,
              children: t('quote'),
            })
            : null,
          // A real anchor rather than a button with a handler. The target URL is
          // computable from the address, so nothing asynchronous has to happen on
          // click — which is what makes the browser treat it as a user-initiated
          // navigation instead of a popup to block. (The previous version called an
          // async API first and then opened, and a popup blocker reads that as
          // unsolicited; additionally, no automated synthetic click can verify that
          // path, because synthetic clicks are never trusted.)
          jsx('a', {
            key: 'open',
            'data-kdocs-open': 'true',
            href: openHref,
            target: '_blank',
            rel: 'noreferrer',
            style: HEADER_ACTION_STYLE,
            children: t('openInKDocs'),
          }),
        ],
      });

      const body = [];
      if (mode === 'text' && doc.loading) {
        body.push(jsx('div', { key: 'loading', style: { padding: '12px', fontSize: '12px', opacity: 0.6 }, children: t('loading') }));
      } else if (mode === 'text' && doc.error !== undefined) {
        body.push(jsx('div', { key: 'error', style: { ...NOTE_STYLE, padding: '12px 10px', color: 'var(--dsw-alias-label-secondary)' }, children: doc.error.message }));
      } else if (mode === 'text' && doc.format === 'unsupported') {
        // A pending extraction or an unsupported type: the Host explains which.
        body.push(jsx('div', { key: 'unsupported', style: { padding: '12px', fontSize: '12px', opacity: 0.8 }, children: doc.content ?? t('noPreview') }));
      } else if (mode === 'text') {
        body.push(jsx('div', {
          key: 'content',
          style: { padding: '4px 12px 16px', fontSize: '13px' },
          // Selecting a passage is how a reader says "this part"; the button that
          // follows is the whole affordance, so the handler lives on the article.
          onMouseUp: onReaderMouseUp,
          children: renderBlocks(parseMarkdown(doc.content ?? '')),
        }));
        if (doc.truncated) {
          body.push(jsx('div', { key: 'truncated', style: { padding: '0 12px 12px', fontSize: '11.5px', opacity: 0.6 }, children: t('truncated') }));
        }
      }

      const scrollArea = jsx('div', {
        key: 'scroll',
        'data-kdocs-scroll': 'true',
        style: { flex: '1 1 auto', minHeight: '0', overflow: 'auto' },
        children: body,
      });

      // The embedded viewer gets its own region rather than living inside the
      // scrolling one, and the frame is absolutely positioned to fill it.
      //
      // Two layout facts forced this. An `<iframe>` is a replaced element: with no
      // explicit height it falls back to the default 150px, so the viewer rendered
      // as a short strip with the rest of the panel blank. And `height: 100%` does
      // nothing against an auto-height flex parent — absolute positioning against a
      // positioned ancestor is the one approach that cannot depend on the chain.
      const embedArea = embedding
        ? jsxs('div', {
          key: 'embedArea',
          'data-kdocs-embed-area': 'true',
          // The column flex is load-bearing: the inner wrapper gets its height from
          // `flex: 1 1 auto` here, and the absolutely positioned frame fills that
          // wrapper. Removing it (when the hint bar moved to the header) collapsed
          // the wrapper to zero and the frame with it.
          style: { flex: '1 1 auto', minHeight: '0', display: 'flex', flexDirection: 'column' },
          children: [
            jsx('div', {
              key: 'frame',
              style: { position: 'relative', flex: '1 1 auto', minHeight: '0' },
              children: jsx('iframe', {
                // The nonce is the reload: a new `key` remounts the element, and a
                // fresh load is the only way a newly signed-in session reaches the
                // viewer. Leaving `src` alone deliberately — the address is identity.
                key: `embed-${String(nonce)}`,
                src: embedUrl,
                title: name,
                'data-kdocs-embed': 'true',
                // The frame cannot be inspected across origins, so a failure is
                // silent by nature; the header's sign-in control and the hint below
                // are what tell a reader what to do when they see a sign-in page
                // instead of their document.
                //
                // The white here is the file's one literal colour, and it is not a
                // theme decision: 金山文档's viewer paints a white page, so this is the
                // colour of the *content*, not of our chrome. Following the panel's
                // theme would put a dark rectangle behind a white document and flash
                // it on every load.
                style: { position: 'absolute', inset: '0', width: '100%', height: '100%', border: '0', background: '#fff' },
              }),
            }),
          ],
        })
        : undefined;

      return jsxs('div', {
        'data-kdocs-preview': embedding ? 'embed' : (doc.format ?? 'pending'),
        style: { display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box', overflow: 'hidden' },
        children: [
          header,
          embedding ? embedArea : scrollArea,
          // Fixed-positioned, so it floats over the reader wherever the selection
          // was made. `--dsw-alias-bg-overlay` is the theme's own popover surface:
          // a transparent button over body text is unreadable in one of the two
          // themes, and inventing a colour here is how the panel first went wrong.
          selection === undefined
            ? null
            : jsx('button', {
              key: 'quoteSelection',
              type: 'button',
              'data-kdocs-quote-selection': 'true',
              onClick: quoteSelection,
              style: {
                position: 'fixed',
                left: `${String(selection.x)}px`,
                top: `${String(selection.y)}px`,
                zIndex: 40,
                font: 'inherit',
                fontSize: '12px',
                padding: '4px 10px',
                borderRadius: '6px',
                border: '0.5px solid var(--dsw-alias-border-l2)',
                background: 'var(--dsw-alias-bg-overlay)',
                color: 'var(--dsw-alias-label-primary)',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.18)',
              },
              children: t('quoteSelection'),
            }),
        ],
      });
    }

    // ── the right sidebar's 金山文档 panel ──────────────────────────────────
    //
    // Registered the same public two-stage way the product's own `files` tab uses:
    // the type into `ctx.sidebarRightTabs`, the body and chip title into the keyed
    // `sidebar.right.pane.tab` / `.title` seats under this definition's `id`.
    //
    // A *page* type, not a viewer: it claims no resource address. A file click
    // instead opens the address this plugin's resource protocol owns, and the
    // viewer that claims it (M6) draws it.

    /** This tab type's kind, and what `openTab` names. */
    const KDOCS_KIND = 'kdocs-files';
    /** This implementation's identity in the tab system, and the body's seat key. */
    const KDOCS_ID = 'kdocs';

    /**
     * The sign-in page's kind, and the body seat key it registers under.
     *
     * A *page* type, like the panel: it claims no address and is opened by kind.
     *
     * It exists because the "原版" embed is authenticated by the **web** 金山文档
     * session and by nothing else. The kdocs-cli token the panel's own notice
     * describes is a different credential — offered as a cookie it is rejected
     * (measured: 403 `userNotLogin`). In a desktop shell the web session belongs to
     * the app's own Chromium profile, which the reader's system browser does not
     * share, so signing in "in the browser" cannot help the embed. This page is a
     * surface the *app* loads, which is the only place such a session can be made.
     */

    /** The copy namespace this panel's strings register under. */
    const KDOCS_NS = 'kdocsSidebar';

    /** Panel copy. Thunked lookups on the registry re-read these per language. */
    const KDOCS_ZH = {
      guideTitle: '金山文档',
      guideDescription: '浏览个人金山文档云盘',
      searchPlaceholder: '搜索云文档',
      loading: '加载中…',
      loadMore: '加载更多',
      empty: '此文件夹为空',
      noResults: '没有匹配的文档',
      notAuthenticated: '金山文档未登录。本插件依赖官方 kdocs-cli —— 请先装好它并完成登录，再回来使用：',
      loginSteps: '1) 安装 kdocs-cli —— 官方仓库 github.com/kdocs-app/kdocs-skill 的 scripts/ 下有三平台安装脚本\n   macOS / Linux：setup.sh    Windows：setup.ps1    已有 Node.js：setup.cjs\n\n2) 登录（它会把授权链接打印出来，在浏览器里打开那个链接）\n   kdocs-cli auth login',
      retry: '重试',
      rootLabel: '我的云文档',
      searchResults: '搜索结果',
      openInKDocs: '在金山文档打开',
      previewFallbackTitle: '金山文档',
      unsupportedAddress: '这不是一个可识别的金山文档地址',
      readFailed: '读取正文失败',
      noPreview: '该文件没有可预览的正文',
      truncated: '正文过长，已截断显示。',
      modeEmbed: '原版',
      modeText: '文本',
      embedSignIn: '在金山文档中打开',
      embedReload: '刷新「原版」',
      quote: '引用到对话',
      quoteSelection: '引用选中片段',
      viewTree: '我的云文档',
      viewStarred: '星标',
      viewRecent: '最近',
      viewSharedWithMe: '共享给我',
      viewSharedByMe: '我分享的',
      viewTrash: '回收站',
      recheck: '重新检查',
      scopeAll: '全部',
      scopeName: '文件名',
      scopeContent: '正文',
      rowMenu: '更多操作',
      menuQuote: '引用到对话',
      menuOpen: '在金山文档打开',
      menuCopyLink: '复制链接',
      menuDetail: '查看详情',
      menuRename: '重命名…',
      menuVersions: '历史版本',
      menuComments: '正文批注',
      commentsNote: '正文批注（原样返回）：',
      commentsEmpty: '这个文档没有正文批注。',
      commentsFailed: '读取正文批注失败。',
      versionsNote: '历史版本（新→旧）：',
      versionsEmpty: '这个文档没有历史版本。',
      versionsFailed: '读取历史版本失败。',
      quotedNote: '已写入输入框，接着说你要做什么即可。',
      linkNote: '链接如下（若未自动打开，可复制到浏览器）。',
      copiedNote: '链接已复制到剪贴板。',
      detailFailed: '读取详情失败。',
      detailKind: '类型',
      detailExt: '格式',
      detailModified: '修改时间',
      detailSize: '大小',
      detailAddress: '地址',
      detailClose: '关闭',
      renameLabel: '新名称（后缀会自动保留）',
      renameCommit: '重命名',
      renameCancel: '取消',
      renameBusy: '处理中…',
      renameFailed: '重命名失败。',
      rechecking: '检查中…',
      toolFailed: '调用失败',
      quoteHint: '把这个文档的地址写进输入框，然后直接说要做什么（例如「帮我总结」）',
    };
    const KDOCS_EN = {
      guideTitle: 'KDocs',
      guideDescription: 'Browse your personal 金山文档 drive',
      searchPlaceholder: 'Search documents',
      loading: 'Loading…',
      loadMore: 'Load more',
      empty: 'This folder is empty',
      noResults: 'No matching documents',
      notAuthenticated: 'Not signed in to 金山文档. This plugin runs on the official kdocs-cli — install it and sign in first:',
      loginSteps: '1) Install kdocs-cli — the official repo github.com/kdocs-app/kdocs-skill ships one installer per platform under scripts/\n   macOS / Linux: setup.sh    Windows: setup.ps1    Node.js: setup.cjs\n\n2) Sign in (it prints an authorisation link; open that link in a browser)\n   kdocs-cli auth login',
      retry: 'Retry',
      rootLabel: 'My Documents',
      searchResults: 'Search results',
      openInKDocs: 'Open in 金山文档',
      previewFallbackTitle: 'KDocs',
      unsupportedAddress: 'Not a recognizable 金山文档 address',
      readFailed: 'Could not read the document body',
      noPreview: 'This file has no previewable body',
      truncated: 'The body was truncated for display.',
      modeEmbed: 'Original',
      modeText: 'Text',
      embedSignIn: 'Open in 金山文档',
      embedReload: 'Reload Original view',
      quote: 'Quote in chat',
      quoteSelection: 'Quote selection',
      viewTree: 'My drive',
      viewStarred: 'Starred',
      viewRecent: 'Recent',
      viewSharedWithMe: 'Shared with me',
      viewSharedByMe: 'Shared by me',
      viewTrash: 'Recycle bin',
      recheck: 'Check again',
      scopeAll: 'All',
      scopeName: 'Names',
      scopeContent: 'Contents',
      rowMenu: 'More actions',
      menuQuote: 'Quote in chat',
      menuOpen: 'Open in 金山文档',
      menuCopyLink: 'Copy link',
      menuDetail: 'Details',
      menuRename: 'Rename…',
      menuVersions: 'Version history',
      menuComments: 'Annotations',
      commentsNote: 'Annotations in the body (as returned):',
      commentsEmpty: 'This document has no annotations.',
      commentsFailed: 'Could not read the annotations.',
      versionsNote: 'Version history (newest first):',
      versionsEmpty: 'This document has no saved versions.',
      versionsFailed: 'Could not read the version history.',
      quotedNote: 'Written into the composer — say what to do with it next.',
      linkNote: 'Link below; copy it into a browser if it did not open.',
      copiedNote: 'Link copied to the clipboard.',
      detailFailed: 'Could not read the details.',
      detailKind: 'Kind',
      detailExt: 'Format',
      detailModified: 'Modified',
      detailSize: 'Size',
      detailAddress: 'Address',
      detailClose: 'Close',
      renameLabel: 'New name (the extension is kept)',
      renameCommit: 'Rename',
      renameCancel: 'Cancel',
      renameBusy: 'Working…',
      renameFailed: 'Rename failed.',
      rechecking: 'Checking…',
      toolFailed: 'Call failed',
      quoteHint: 'Write this document\'s address into the composer, then say what to do with it',
    };

    /**
     * The panel's state machine, independent of React.
     *
     * Kept as plain functions taking and returning state so it is testable
     * without a renderer — the bundle exports it, and `test/sidebar-panel.test.js`
     * drives it. `apply` only wires it to hooks.
     *
     * Directory contents are fetched **lazily, per folder, on first expand**: a
     * personal drive holds far too much to load eagerly, and this mirrors how the
     * product's own files tree behaves.
     */

    /** The initial panel state: the root level is open, nothing is loaded yet. */
    function initialPanelState() {
      return {
        /** `driveId -> { entries, cursor, loading, error }`, plus the root under `ROOT`. */
        levels: {},
        /** Folder keys whose children are shown. */
        expanded: {},
        /** Which left-hand tab is showing: the folder tree, or one curated view. */
        view: 'tree',
        /** `view -> { entries, cursor, loading, error }`, loaded on first open. */
        views: {},
        query: '',
        /** Which field the query matches: names, bodies, or both. */
        searchScope: 'all',
        search: { active: false, loading: false, entries: [], cursor: undefined, total: undefined, error: undefined },
        /** Set when a call reported the account is not signed in. */
        needsLogin: false,
      };
    }

    /**
     * Where the panel was, so reopening it does not start from scratch.
     *
     * Module scope, not React state, and that is the point: the right sidebar
     * unmounts the body when its tab closes, so anything held in the component is
     * gone by the time the user comes back. Only *position* is kept — never
     * listings, which would go stale and defeat the point of a live drive.
     *
     * @type {{ expanded: Record<string, boolean>, query: string }}
     */
    const panelMemory = { expanded: {}, query: '' };

    /** Fresh panel state, positioned where the last mount left off. */
    function restoredPanelState() {
      const state = initialPanelState();
      // Copied, not aliased: the live state mutates by replacement, and an alias
      // would make the memory change before the render that saved it.
      state.expanded = { ...panelMemory.expanded };
      state.query = panelMemory.query;
      return state;
    }

    /**
     * Whether the opt-in diagnostics surface is published.
     *
     * The panel's live state is otherwise invisible from outside React, which
     * once made a render failure indistinguishable from a fetch failure (see the
     * TDZ and hook-order retro in the docs). That capability is worth keeping —
     * but not by leaving a real drive listing on `window`, where every other page
     * script and every other plugin shares it. So it is opt-in, it publishes only
     * counts, flags and error codes, and it lives only while a panel is mounted.
     *
     * **The flag is in `localStorage`, not the URL, and that is a measured
     * decision rather than a preference.** The obvious `?kdocs-debug=1` does not
     * work here: DSH consumes its own `?token=` during boot and rewrites
     * `location` to the bare origin, so by the time any of this code runs the
     * search string is already empty — verified in the browser, where
     * `location.search` was `''` with the parameter still in the requested URL.
     * Reading at panel mount (rather than at bundle load) also means the switch
     * can be flipped and picked up by reopening the panel, with no reload.
     *
     * @returns {boolean} true when diagnostics were explicitly requested.
     */
    function kdocsDebugEnabled() {
      try {
        return window.localStorage.getItem('kdocs-debug') === '1';
      } catch {
        // A page may forbid storage. Diagnostics are opt-in, so the failure
        // direction is "stay off".
        return false;
      }
    }

    /**
     * Summarise panel state for diagnostics without carrying drive content.
     *
     * Folder and file names are the sensitive part of this plugin's data, so the
     * summary carries none of them: a level is reported as counts and flags, and
     * the search query as a length. That is enough to tell "still loading" from
     * "failed" from "returned nothing", which is what this surface is for.
     *
     * @param {any} state - the panel's current state.
     * @param {any} lastError - the most recent rejected call, if any.
     * @returns {any} a name-free snapshot.
     */
    function summarisePanelState(state, lastError) {
      const levels = Object.keys(state.levels).map((key) => {
        const level = state.levels[key];
        const error = level.error;
        return {
          key: key === ROOT_LEVEL ? '(root)' : key,
          entries: Array.isArray(level.entries) ? level.entries.length : 0,
          hasCursor: level.cursor !== undefined,
          loading: level.loading === true,
          error: error === undefined
            ? undefined
            : String(error.code ?? error.message ?? 'unknown'),
        };
      });
      return {
        levels,
        expanded: Object.keys(state.expanded).length,
        // The query itself can name a case or a client; its length cannot.
        queryLength: state.query.length,
        search: {
          active: state.search.active,
          loading: state.search.loading,
          entries: state.search.entries.length,
          hasCursor: state.search.cursor !== undefined,
          error: state.search.error === undefined
            ? undefined
            : String(state.search.error.code ?? state.search.error.message ?? 'unknown'),
        },
        needsLogin: state.needsLogin,
        lastError: lastError === undefined ? undefined : String(lastError),
      };
    }

    /** How long typing settles before a search is issued. */
    const SEARCH_DEBOUNCE_MS = 250;

    /**
     * Fold a rejected Remote call into the same envelope a business failure uses.
     *
     * The Remote face *resolves* with a settled envelope on an expected failure
     * and only rejects on a transport or Gateway fault. That second shape used to
     * skip every state transition the panel relies on — most visibly the
     * `loading: false` that ends a spinner, which is how one failed root listing
     * left the pane reading "loading" for the rest of the session.
     *
     * @param {() => Promise<any>} call - the Remote invocation.
     * @param {AbortSignal} [signal] - the tab's signal.
     * @returns {Promise<any>} the envelope, a synthesised failure, or `undefined`
     *   when the call was abandoned because the tab closed.
     */
    async function settleRemoteCall(call, signal) {
      try {
        return await call();
      } catch (error) {
        if (signal !== undefined && signal.aborted) return undefined;
        return {
          ok: false,
          error: { code: 'transport', message: String(error && error.message ? error.message : error) },
        };
      }
    }

    /**
     * The cloud drive's home page, for the "open in 金山文档" control on the tree.
     *
     * The folder tree's *root* is not a file: it has no id, and a root listing
     * carries no `link_url` (measured — per-item links appear for starred entries
     * but not for the root page). So the honest target is the drive home itself.
     * Recorded as embeddable, but opened in a new tab rather than embedded: that
     * page carries delete and share surfaces, and the panel is not the place for
     * them.
     */
    const KDOCS_HOME_URL = 'https://www.kdocs.cn/latest';

    /** The level key of the drive root. */
    const ROOT_LEVEL = '\u0000root';

    /**
     * The longest selection worth quoting verbatim.
     *
     * Past this the excerpt is dropped and only the handle is written. That is
     * deliberate: an excerpt is a *pointer* ("this passage"), so a long one both
     * bloats the prompt and invites the model to treat a partial copy as the whole
     * document — which the address lets it read properly instead.
     */
    const QUOTE_EXCERPT_LIMIT = 800;

    /**
     * The one line this plugin writes into the composer when a document is quoted.
     *
     * The handle is the `dsh-resource://` address rather than a kdocs.cn URL, and
     * that is a measured choice rather than a style one. The CLI accepts a
     * document's *share* link, but it rejects
     * `https://www.kdocs.cn/l/<fileId>?f=<driveId>` — the form this plugin builds
     * for its own embed — with `400100 第三方服务错误`. The address is also the
     * exact string `kdocs_read` takes back as `address`, so the model hands it
     * over verbatim and neither side has to reconstruct an identity.
     *
     * @param {string} name - the document's display name.
     * @param {string} address - its `dsh-resource://` address.
     * @param {string} [excerpt] - the passage the user selected, when short enough.
     * @returns {string} the marker.
     */
    function kdocsQuoteMarker(name, address, excerpt) {
      const head = `📄金山文档「${name}」 ${address}`;
      const passage = typeof excerpt === 'string' ? excerpt.trim() : '';
      if (passage === '' || passage.length > QUOTE_EXCERPT_LIMIT) return head;
      return `${head}\n选中的片段：\n${passage}`;
    }

    /** The level key of one folder. */
    function folderKey(ref) {
      return `${ref.driveId}/${ref.fileId}`;
    }

    /**
     * The outcome of one list or search call, folded into the state.
     *
     * `result` is the **framework's** envelope — `{ ok: true, value }` or
     * `{ ok: false, error }` — because the Client API wraps every Remote call.
     * The business value therefore sits at `result.value`, and no second envelope
     * exists to unwrap.
     *
     * A failure is recorded, never thrown: a panel must render the failure, and a
     * `not-authenticated` code additionally flips the panel to its sign-in notice.
     *
     * @param {any} state - the current state.
     * @param {string} key - the level key the result belongs to.
     * @param {any} result - the `remote.kdocs.list` envelope.
     * @param {boolean} [replace] - true to replace the level rather than append to it.
     *   A refresh has to say so: the append path is what paging relies on, and
     *   reusing it to reload a level is how a list silently doubles.
     * @returns {any} the next state.
     */
    function applyListResult(state, key, result, replace) {
      const level = state.levels[key] ?? { entries: [], cursor: undefined, loading: false, error: undefined };
      const settled = unwrapResult(result);
      if (settled.ok === true) {
        const entries = settled.value?.entries ?? [];
        return {
          ...state,
          needsLogin: false,
          levels: {
            ...state.levels,
            [key]: {
              entries: replace === true ? entries : level.entries.concat(entries),
              cursor: settled.value?.nextCursor,
              loading: false,
              error: undefined,
            },
          },
        };
      }
      const error = settled.error ?? { code: 'unknown', message: 'unknown failure' };
      // A business failure crosses as `gateway/internal` with the Host's message;
      // the sign-in hint is recognized from either shape so a credential problem
      // still reads as one.
      const notAuthenticated = error.code === 'not-authenticated'
        || String(error.message ?? '').includes('未登录');
      return {
        ...state,
        needsLogin: state.needsLogin || notAuthenticated,
        levels: { ...state.levels, [key]: { ...level, loading: false, error } },
      };
    }

    /**
     * Fold one curated-view response into the state.
     *
     * Views live apart from `levels` on purpose: they are not the folder tree,
     * they take no parent, and opening one must not disturb where the user was in
     * the tree — switching back has to land on the same expanded folders.
     *
     * @param {any} state - the current state.
     * @param {string} view - which view this page belongs to.
     * @param {any} result - the `remote.kdocs.listView` envelope.
     * @param {boolean} [append] - true when this is a further page of the same view.
     * @returns {any} the next state.
     */
    function applyViewResult(state, view, result, append) {
      const current = state.views[view] ?? { entries: [], cursor: undefined, loading: false, error: undefined };
      const settled = unwrapResult(result);
      if (settled.ok === true) {
        const entries = settled.value?.entries ?? [];
        return {
          ...state,
          needsLogin: false,
          views: {
            ...state.views,
            [view]: {
              entries: append === true ? current.entries.concat(entries) : entries,
              cursor: settled.value?.nextCursor,
              loading: false,
              error: undefined,
            },
          },
        };
      }
      const error = settled.error ?? { code: 'unknown', message: 'unknown failure' };
      const notAuthenticated = error.code === 'not-authenticated'
        || String(error.message ?? '').includes('未登录');
      return {
        ...state,
        needsLogin: state.needsLogin || notAuthenticated,
        views: {
          ...state.views,
          [view]: {
            ...current,
            loading: false,
            // A failed first page has no cursor worth keeping; a failed *further* page
            // must keep the one it was reading, or the failure destroys the only
            // control that can retry it. Clearing it unconditionally was a dead end
            // with no way out: the load-more button renders only when a cursor exists,
            // so one transient failure removed the button, and `openView` early-returns
            // for a view already in state — leaving the pane on an error line until the
            // whole panel was reopened. `append` is exactly that distinction, and it is
            // the rule `applyListResult` already followed.
            cursor: append === true ? current.cursor : undefined,
            error,
          },
        },
      };
    }

    /**
     * Fold one search response into the state.
     *
     * @param {any} state - the current state.
     * @param {any} result - the `remote.kdocs.search` envelope.
     * @param {boolean} [append] - true when this is a further page of the same query.
     * @returns {any} the next state.
     */
    function applySearchResult(state, result, append) {      const settled = unwrapResult(result);
      if (settled.ok === true) {
        const entries = settled.value?.entries ?? [];
        return {
          ...state,
          needsLogin: false,
          search: {
            active: true,
            loading: false,
            entries: append === true ? state.search.entries.concat(entries) : entries,
            cursor: settled.value?.nextCursor,
            // The backend's own count, absent unless the call asked for it.
            total: typeof settled.value?.total === 'number' ? settled.value.total : state.search.total,
            error: undefined,
          },
        };
      }
      const error = settled.error ?? { code: 'unknown', message: 'unknown failure' };
      const notAuthenticated = error.code === 'not-authenticated'
        || String(error.message ?? '').includes('未登录');
      return {
        ...state,
        needsLogin: state.needsLogin || notAuthenticated,
        // A failed further page keeps what is already on screen; only a failed
        // first page clears the list.
        search: {
          active: true,
          loading: false,
          entries: append === true ? state.search.entries : [],
          // ...and it keeps the cursor for the same reason: the load-more control is
          // drawn only while one exists, so clearing it here turned one transient
          // failure into a list that nothing could extend again.
          cursor: append === true ? state.search.cursor : undefined,
          total: undefined,
          error,
        },
      };
    }

    /**
     * Expand or collapse one folder without issuing a call.
     *
     * Returning "should load" as a separate answer keeps the reducer pure: the
     * caller decides whether to fetch, which is what makes the lazy-load policy
     * testable.
     *
     * @param {any} state - the current state.
     * @param {string} key - the folder's level key.
     * @returns {{ state: any, shouldLoad: boolean }} the next state and whether to fetch.
     */
    function toggleFolder(state, key) {
      if (state.expanded[key] === true) {
        const expanded = { ...state.expanded };
        delete expanded[key];
        return { state: { ...state, expanded }, shouldLoad: false };
      }
      const expanded = { ...state.expanded, [key]: true };
      const already = state.levels[key] !== undefined;
      return { state: { ...state, expanded }, shouldLoad: !already };
    }

    /** Mark one level as loading, so a second expand does not fetch it twice. */
    function markLoading(state, key) {
      const level = state.levels[key] ?? { entries: [], cursor: undefined, loading: false, error: undefined };
      return { ...state, levels: { ...state.levels, [key]: { ...level, loading: true, error: undefined } } };
    }

    /**
     * The chip title of one kdocs tab.
     *
     * The panel is a page, so its title is fixed copy rather than an address.
     *
     * @param {any} t - namespace-bound translate.
     * @returns {(address: string) => string} the title function.
     */
    function kdocsTitle(t) {
      return () => t('guideTitle');
    }

    /**
     * The tab type's registry definition.
     *
     * No `patterns`: a page type is opened by kind and recognizes no address.
     * `priority` is left to its default (`extension`), which is correct for a type
     * shipped outside the product.
     *
     * @param {any} t - namespace-bound translate.
     * @returns {any} the definition.
     */
    function kdocsDefinition(t) {
      return {
        id: KDOCS_ID,
        kind: KDOCS_KIND,
        title: () => t('guideTitle'),
        guide: [
          {
            order: 60,
            title: () => t('guideTitle'),
            description: () => t('guideDescription'),
          },
        ],
      };
    }


    /** The metrics of one file tree row — the tree's whole vertical budget. */
    const ROW_METRICS = {
      radius: '8px',
      padding: '0 8px',
      gap: '6px',
      height: '24px',
      /** One nesting level. */
      indent: '14px',
    };

    /**
     * The panel's style vocabulary.
     *
     * Values are lifted from the product's own files panel rather than invented:
     * nested levels indent stepwise, the header border is `0.5px`, and every colour
     * is a `--dsw-alias-*` design token — which is what makes the panel follow the
     * theme. Hard-coded greys do not, and were the main reason this panel looked
     * foreign next to Workspace files.
     *
     * Only tokens with a documented role are used:
     * `label-primary` (content), `label-secondary` (supporting), `label-tertiary`
     * (icons and metadata), `interactive-bg-hover` (hover), `border-l3` (dividers).
     *
     * `height` is declared rather than left to padding: the icon column must not be
     * allowed to grow the row, and a declared height plus `box-sizing` makes 24px a
     * property of the row instead of a consequence of its contents.
     */
    const ROW_STYLE = {
      display: 'flex',
      alignItems: 'center',
      gap: ROW_METRICS.gap,
      width: '100%',
      minWidth: 0,
      height: ROW_METRICS.height,
      boxSizing: 'border-box',
      // `font: inherit` matters: a <button> does not inherit font by default, so
      // without it the tree renders in the browser's UI font and reads as bolted-on.
      font: 'inherit',
      color: 'inherit',
      textAlign: 'left',
      cursor: 'pointer',
      background: 'none',
      border: 0,
      borderRadius: ROW_METRICS.radius,
      padding: ROW_METRICS.padding,
    };

    /**
     * The row wrapper, which is also the positioning context for the row's quick
     * menu button.
     *
     * `position: relative` is load-bearing: the `···` control is absolutely
     * positioned over the tail of the file name, so it costs the name no width and
     * cannot push the `.docx` out of sight when it appears.
     */
    const ROW_WRAPPER_STYLE = {
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      minWidth: 0,
    };

    /** The panel root's own metrics, matching the files panel's container. */
    const PANEL_STYLE = {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      boxSizing: 'border-box',
      color: 'var(--dsw-alias-label-primary)',
      fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
      minHeight: 0,
    };

    /**
     * A search field that reads as part of the panel rather than a default input.
     *
     * It shares the file rows' 24px height and 8px radius on purpose: the field,
     * the scope control and the rows are one column of equally-sized targets, so
     * the panel reads as a list with a filter rather than a form above a list.
     *
     * It is `flex: 1 1 auto` with `minWidth: 0`, not `width: 100%`: the field and
     * the scope control now share one row, and a 100%-wide field pushed the scope
     * control out of the row entirely (measured — the panel rendered the field
     * alone and the scope buttons were nowhere). `minWidth: 0` is what lets a flex
     * item shrink below its input's intrinsic width instead of overflowing.
     */
    const SEARCH_STYLE = {
      flex: '1 1 auto',
      minWidth: 0,
      boxSizing: 'border-box',
      fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
      font: 'inherit',
      height: ROW_METRICS.height,
      padding: '0 8px',
      borderRadius: ROW_METRICS.radius,
      border: '0.5px solid var(--dsw-alias-border-l3)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      outline: 'none',
    };

    /** One muted line of status copy, like the files panel's own notes. */
    const NOTE_STYLE = {
      color: 'var(--dsw-alias-label-tertiary)',
      fontSize: '12px',
      lineHeight: '16px',
      margin: 0,
      padding: `2px ${SPACE.md}`,
    };

    /**
     * The text-only "tab" the navigation and the search scope both use.
     *
     * 0.2 rendered six view entries and three scope entries as bordered pills, so
     * the top of the panel was nine capsules — "button → button → button", which is
     * the one thing the 0.2.5 brief rules out. The selected state is carried by ink
     * weight and a 2px underline drawn as an inset shadow (a border would change
     * the box height and shift every tab as the selection moved).
     */
    const TAB_STYLE = {
      font: 'inherit',
      fontSize: '12px',
      lineHeight: '18px',
      padding: '0 0 2px',
      margin: 0,
      border: 0,
      borderRadius: 0,
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      flex: '0 0 auto',
    };

    /** The selected tab: full ink, supporting weight, a 2px underline. */
    const TAB_ACTIVE_STYLE = {
      ...TAB_STYLE,
      color: 'var(--dsw-alias-label-primary)',
      fontWeight: 500,
      boxShadow: 'inset 0 -2px 0 0 var(--dsw-alias-label-primary)',
    };

    /**
     * The file-type glyph table.
     *
     * One source of truth for "what does this file look like": each kind names a
     * colour token and a shape, and both the row icon and any future surface read
     * from here. The shapes are our own minimal geometry — the brief is explicit
     * that WPS's marks are not to be copied — and every one is drawn on the same
     * 16×16 grid with the same bounding box, so the icon column is a column and
     * not a ragged edge.
     *
     * Colours are `--dsw-static-*` accents deliberately: the palette is the
     * product's, so a Word document is the same blue the product already uses, and
     * it does not drift the first time the alias layer changes. `mix()` compensates
     * those static values into the active palette — see {@link fileIconColor}.
     */
    const FILE_ICONS = {
      folder: {
        color: 'var(--dsw-static-amber-500)',
        body: '<path d="M1.9 3.6a1.4 1.4 0 0 1 1.4-1.4h2.8l1.5 1.8h5.1a1.4 1.4 0 0 1 1.4 1.4v6.8a1.4 1.4 0 0 1-1.4 1.4H3.3a1.4 1.4 0 0 1-1.4-1.4Z" fill="currentColor" fill-opacity=".22"/><path d="M1.9 6.2h12.2v.9H1.9Z" fill="currentColor" fill-opacity=".45"/>',
      },
      doc: {
        color: 'var(--dsw-static-blue-500)',
        body: '<path d="M3.4 2.6a1 1 0 0 1 1-1h4.4L12 4.7v8.7a1 1 0 0 1-1 1H4.4a1 1 0 0 1-1-1Z" fill="currentColor" fill-opacity=".22"/><path d="M8.6 1.5v2.3a1 1 0 0 0 1 1H12Z" fill="currentColor" fill-opacity=".5"/><path d="M4.4 11.9h7.2v1.2H4.4Z" fill="currentColor"/>',
      },
      sheet: {
        color: 'var(--dsw-static-green-500)',
        body: '<rect x="2.6" y="2.2" width="10.8" height="11.6" rx="1.2" fill="currentColor" fill-opacity=".22"/><path d="M2.6 5.6h10.8v1.1H2.6Zm0 3.3h10.8v1.1H2.6Z" fill="currentColor" fill-opacity=".55"/><path d="M7.5 5.6h1.2v8.2H7.5Z" fill="currentColor" fill-opacity=".55"/>',
      },
      slides: {
        color: 'var(--dsw-static-amber-500)',
        body: '<rect x="2.4" y="2.6" width="11.2" height="8" rx="1.1" fill="currentColor" fill-opacity=".22"/><path d="M7.2 4.5v4.2l3.5-2.1Z" fill="currentColor"/><path d="M7.4 10.6h1.2V13H7.4Z" fill="currentColor" fill-opacity=".55"/><path d="M4.6 13h6.8v1.1H4.6Z" fill="currentColor" fill-opacity=".55"/>',
      },
      pdf: {
        color: 'var(--dsw-static-red-500)',
        body: '<path d="M3.4 2.6a1 1 0 0 1 1-1h4.4L12 4.7v8.7a1 1 0 0 1-1 1H4.4a1 1 0 0 1-1-1Z" fill="currentColor" fill-opacity=".2"/><path d="M8.6 1.5v2.3a1 1 0 0 0 1 1H12Z" fill="currentColor" fill-opacity=".5"/><rect x="3.8" y="9" width="8.4" height="3.6" rx=".6" fill="currentColor"/><path d="M4.9 10.1h1.5v1.4H4.9Zm2.35 0h3.85v1.4H7.25Z" fill="var(--dsw-alias-bg-base)"/>',
      },
      text: {
        color: 'var(--dsw-alias-label-tertiary)',
        body: '<path d="M3.4 2.6a1 1 0 0 1 1-1h4.4L12 4.7v8.7a1 1 0 0 1-1 1H4.4a1 1 0 0 1-1-1Z" fill="currentColor" fill-opacity=".18"/><path d="M8.6 1.5v2.3a1 1 0 0 0 1 1H12Z" fill="currentColor" fill-opacity=".4"/><path d="M4.6 6.6h6.8v1.1H4.6Zm0 2.5h6.8v1.1H4.6Zm0 2.5h4.2v1.1H4.6Z" fill="currentColor" fill-opacity=".75"/>',
      },
      image: {
        color: 'var(--dsw-static-blue-450)',
        body: '<rect x="2.3" y="3" width="11.4" height="10" rx="1.2" fill="currentColor" fill-opacity=".22"/><circle cx="6" cy="6.4" r="1.1" fill="currentColor"/><path d="M3.2 12.2 6.9 8.3l2.5 2.7 1.8-1.7 2 2.9Z" fill="currentColor"/>',
      },
      generic: {
        color: 'var(--dsw-alias-label-tertiary)',
        body: '<path d="M3.4 2.6a1 1 0 0 1 1-1h4.4L12 4.7v8.7a1 1 0 0 1-1 1H4.4a1 1 0 0 1-1-1Z" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/><path d="M8.6 1.5v2.3a1 1 0 0 0 1 1H12" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/>',
      },
    };

    /**
     * The suffix → kind table.
     *
     * Deliberately explicit rather than a prefix rule: `dbt` is a WPS spreadsheet
     * template and `potx`/`dotx` are template variants, which no arithmetic on the
     * suffix gets right. An unknown suffix lands on `generic`, which is the correct
     * answer — a file we cannot classify should look like a file, not like a Word
     * document.
     */
    const FILE_KINDS = {
      doc: ['doc', 'docx', 'dot', 'dotx', 'rtf', 'wps'],
      sheet: ['xls', 'xlsx', 'xlsm', 'csv', 'tsv', 'et', 'ett', 'dbt', 'dbsheet'],
      slides: ['ppt', 'pptx', 'pps', 'ppsx', 'dps', 'dpt'],
      pdf: ['pdf'],
      text: ['txt', 'md', 'markdown', 'log', 'json', 'yml', 'yaml', 'xml', 'html', 'htm', 'ini', 'conf'],
      image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tif', 'tiff', 'ico'],
    };

    /**
     * Which icon a file name earns.
     *
     * @param {unknown} name - the file's name, as the drive reports it.
     * @returns {string} a key of {@link FILE_ICONS}.
     */
    function fileKindOf(name) {
      if (typeof name !== 'string') return 'generic';
      const dot = name.lastIndexOf('.');
      // A leading dot is a hidden file, not an extension: `.gitignore` has none.
      if (dot <= 0 || dot === name.length - 1) return 'generic';
      const suffix = name.slice(dot + 1).toLowerCase();
      for (const kind of Object.keys(FILE_KINDS)) {
        if (FILE_KINDS[kind].includes(suffix)) return kind;
      }
      return 'generic';
    }

    /**
     * Which icon an entry earns — a folder is decided by the entry, not by its name.
     *
     * @param {any} entry - a `KDocsEntry`.
     * @returns {string} a key of {@link FILE_ICONS}.
     */
    function entryKindOf(entry) {
      if (entry !== null && typeof entry === 'object' && entry.kind === 'directory') return 'folder';
      return fileKindOf(entry === null || typeof entry !== 'object' ? undefined : entry.name);
    }

    /**
     * Paint one file-type icon.
     *
     * Two deliberate choices. The glyph is set as `innerHTML` from the module's own
     * constant geometry — there is no user data anywhere in it, which is what makes
     * that safe, and it is what avoids writing 60 lines of `jsx('path', …)` per
     * icon. And it is `aria-hidden`: a screen reader announcing "Word document" and
     * then the file name `.docx` says the same thing twice, and the brief asks for
     * the icon to be silent.
     *
     * @param {any} props - `kind`, the icon key.
     * @returns {any} the React element.
     */
    function FileIcon(props) {
      const icon = FILE_ICONS[props.kind] ?? FILE_ICONS.generic;
      return jsx('span', {
        'data-kdocs-icon': props.kind,
        'aria-hidden': 'true',
        style: { flex: 'none', display: 'flex', width: '16px', height: '16px', color: icon.color },
        dangerouslySetInnerHTML: {
          __html: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">${icon.body}</svg>`,
        },
      });
    }


    /**
     * The context menu's container.
     *
     * Flat text on a floating sheet, with no icons anywhere — the brief is explicit
     * about that, and the reason is sound: an icon beside "复制链接" competes with
     * the file-type icons that are supposed to be the only coloured thing in the
     * panel. What is left is the craft: a consistent 28px item, two whisper-thin
     * separators that group *open / link · inspect · rename* without drawing
     * attention to themselves, and the product's own overlay surface behind it.
     */
    const MENU_STYLE = {
      position: 'fixed',
      zIndex: 50,
      minWidth: '180px',
      maxWidth: '260px',
      padding: SPACE.xs,
      borderRadius: '10px',
      border: '0.5px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-overlay)',
      boxShadow: '0 8px 28px rgba(0, 0, 0, 0.24)',
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
    };

    /** The menu's title line: which file this menu is about. */
    const MENU_HEAD_STYLE = {
      padding: `${SPACE.xs} ${SPACE.md} ${SPACE.xs}`,
      fontSize: '11px',
      lineHeight: '16px',
      color: 'var(--dsw-alias-label-tertiary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    };

    /** One menu row. `font: inherit` for the same reason every button here needs it. */
    const MENU_ITEM_STYLE = {
      font: 'inherit',
      fontSize: '12.5px',
      lineHeight: '18px',
      textAlign: 'left',
      width: '100%',
      boxSizing: 'border-box',
      height: '28px',
      display: 'flex',
      alignItems: 'center',
      padding: `0 ${SPACE.md}`,
      border: 0,
      borderRadius: '6px',
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    };

    /**
     * The group divider.
     *
     * Drawn in `border-l3` — the same weight as every other hairline in the panel —
     * so it reads as a fold in the list rather than as a rule. The brief allows an
     * empty gap instead; a 0.5px line at this contrast does the scanning work with
     * less space, which is the trade this whole iteration makes.
     */
    const MENU_SEPARATOR_STYLE = {
      height: '0.5px',
      flex: 'none',
      margin: `${SPACE.xs} ${SPACE.sm}`,
      background: 'var(--dsw-alias-border-l3)',
    };

    /**
     * The left inset that lines a status note up with the file names beneath a row.
     *
     * A note under a folder has to start where that folder's *children's names*
     * start: the nesting step, plus the row's own inline inset, plus its chevron and
     * the gap after it. Composing it here keeps the number in one place, so changing
     * the indent cannot leave the loading line stranded at the old offset.
     *
     * @param {number} depth - the depth of the rows the note belongs beneath.
     * @returns {string} a CSS length.
     */
    function noteIndent(depth) {
      const step = Number.parseInt(ROW_METRICS.indent, 10);
      const inset = Number.parseInt(ROW_METRICS.padding.split(' ')[1], 10);
      const chevron = 14 + Number.parseInt(ROW_METRICS.gap, 10);
      return `${String(depth * step + inset + chevron)}px`;
    }

    /**
     * Render one entry row.
     *
     * The row is `chevron + type icon + name`, with the icon column reserved at a
     * fixed width whether or not the entry is a folder. That reservation is the
     * whole point: 0.2 gave folders a 14px chevron and files nothing, so the two
     * kinds of row started their names at different x positions and the tree read
     * as two lists interleaved. Reserving one 14px chevron slot plus one 16px icon
     * slot for every row means a folder and a file under it line up exactly, and
     * expanding a folder moves no name — which is what §4.4 asks for.
     *
     * @param {any} entry - a `KDocsEntry`.
     * @param {any} options - row wiring.
     * @returns {any} the React element.
     */
    function EntryRow(options) {
      const { entry, depth } = options;
      // `t` arrives as an option, not as a closure.
      //
      // This was the 0.2.5 blank-panel regression, and the shape of the mistake is
      // the lesson: `EntryRow` lives at module scope while `t` is bound inside
      // `apply`'s inject callback, so the row could not see it. Nothing failed until
      // hover, because the only member that uses `t` is the quick-menu button, which
      // renders only while hovered. A pointer landing on the tree then threw
      // `ReferenceError: t is not defined` **during React's reconciliation of a
      // child** — which `guarded()` cannot see, because it only wraps the body's own
      // synchronous call — and the slot runtime answered by emptying the pane. The
      // tree appeared, the pointer arrived, the pane went white.
      const t = options.t;
      const isFolder = entry.kind === 'directory';
      const key = folderKey(entry.ref);
      const open = options.expanded[key] === true;
      const [hover, setHover] = react.useState(false);

      // The quick menu is a progressive enhancement, not a second way to operate a
      // file: it appears on hover or keyboard focus, calls the same handler the
      // right-click does, and is not rendered at all when the panel has no menu
      // (search results and the curated views pass none).
      const showQuickMenu = options.onMenu !== undefined && hover;

      // Children are passed as a prop, never as the variadic third argument: the
      // real jsx runtime dropped them that way and rows committed with no content.
      return jsx('div', {
        'data-kdocs-entry': entry.kind,
        // Indentation lives on the row, not on a wrapper, so the hover highlight
        // spans the full width exactly like the files panel's rows do.
        style: { ...ROW_WRAPPER_STYLE, paddingLeft: `${String(depth * Number.parseInt(ROW_METRICS.indent, 10))}px` },
        children: [
          jsx('button', {
            key: 'row',
            type: 'button',
            title: entry.name,
            'data-kdocs-row': isFolder ? 'folder' : 'file',
            'aria-expanded': isFolder ? (open ? 'true' : 'false') : undefined,
            onClick: () => (isFolder ? options.onToggle(entry, key) : options.onOpen(entry)),
            // The row only reports the gesture; what the menu offers is the panel's
            // business, so a row stays renderable with no menu at all — the guard is
            // real even though every call site currently passes one (tree, curated
            // views and search results all do), and it is what keeps this component
            // usable in a context that has nothing to offer.
            onContextMenu: options.onMenu === undefined
              ? undefined
              : (event) => { event.preventDefault(); options.onMenu(entry, event); },
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            onFocus: () => setHover(true),
            onBlur: () => setHover(false),
            style: hover ? { ...ROW_STYLE, background: 'var(--dsw-alias-interactive-bg-hover)' } : ROW_STYLE,
            children: [
              jsx('span', {
                key: 'chevron',
                'aria-hidden': 'true',
                style: {
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '14px',
                  height: '14px',
                  color: 'var(--dsw-alias-label-tertiary)',
                  // A folder's chevron is a real disclosure control; a file's slot is
                  // empty so both kinds start their icon at the same x.
                  opacity: isFolder ? 1 : 0,
                  // Nudged left inside its 14px slot. The glyph is optically small next
                  // to a 16px icon, and centring it put it hard against the folder; the
                  // shift is transform-only, so it costs the row no width and cannot
                  // move the name beside it.
                  marginLeft: '-3px',
                  transition: 'transform 120ms ease',
                  transform: open ? 'rotate(90deg)' : 'none',
                },
                children: jsx('svg', {
                  width: '14',
                  height: '14',
                  viewBox: '0 0 16 16',
                  fill: 'none',
                  'aria-hidden': 'true',
                  focusable: 'false',
                  children: jsx('path', {
                    d: 'M6.2 3.8 10.4 8l-4.2 4.2',
                    stroke: 'currentColor',
                    strokeWidth: '1.4',
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                  }),
                }),
              }),
              jsx(FileIcon, { key: 'icon', kind: entryKindOf(entry) }),
              jsx('span', {
                key: 'name',
                style: {
                  minWidth: 0,
                  flex: '1 1 auto',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  // A folder carries the full ink, a file the supporting tone, so the
                  // container/file distinction survives at a glance even with icons on.
                  color: isFolder ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
                },
                children: entry.name,
              }),
            ],
          }),
          showQuickMenu
            ? jsx('button', {
              key: 'quick',
              type: 'button',
              // The label is the file it acts on: a screen reader reaching six of
              // these in a row must not hear "more" six times.
              'aria-label': `${t('rowMenu')}：${entry.name}`,
              'data-kdocs-row-menu': folderKey(entry.ref),
              // Without this the row underneath also handles the gesture, and the
              // menu that just opened would be replaced by the row's own action.
              onMouseDown: (event) => { event.preventDefault(); event.stopPropagation(); },
              onClick: (event) => {
                event.stopPropagation();
                options.onMenu(entry, { clientX: event.clientX, clientY: event.clientY });
              },
              style: {
                position: 'absolute',
                right: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                width: '24px',
                height: ROW_METRICS.height,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                border: 0,
                borderRadius: ROW_METRICS.radius,
                background: 'var(--dsw-alias-interactive-bg-hover)',
                color: 'var(--dsw-alias-label-secondary)',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: '13px',
                lineHeight: 1,
              },
              children: '\u22ef',
            })
            : null,
        ],
      });
    }


    /**
     * The panel body.
     *
     * Props come from the seat: `useTabInfo` is the framework-bound tab reader,
     * `t` is this namespace's translate, and `remote` reaches the Host.
     *
     * @param {any} props - seat props.
     * @returns {any} the rendered panel.
     */
    function KDocsBody(props) {
      const { t } = props;
      // Resolved on every call, so the panel works whether it opened before or
      // after the namespace finished mounting. `$mount` is async, and a panel can
      // legitimately be opened first.
      // The seat only renders this body once `ctx.inject(['remote.kdocs'])` has
      // resolved, so the face is present rather than a promise.
      //
      // Every declared parameter is passed positionally, even when undefined: the
      // Client API counts arguments against the descriptor and rejects a call
      // with fewer (`expected 2 business argument(s) plus an optional AbortSignal,
      // got 0`). An omitted optional parameter still crosses as an absent field,
      // because the descriptor accepts undefined for it.
      const face = () => props.remote;
      const { tab } = props.useTabInfo();
      const signal = tab.signal;
      const tabActions = tab.actions;
      const [state, setState] = useState(restoredPanelState);
      // Read the latest state inside async callbacks without re-creating them.
      const stateRef = useRef(state);
      stateRef.current = state;
      /** The most recent rejected call, kept only for the opt-in diagnostics surface. */
      const lastErrorRef = useRef(undefined);
      /** The pending debounce and the id that settles a search race. */
      const searchTimerRef = useRef(undefined);
      const searchSeqRef = useRef(0);
      /** Whether a re-check of the account state is in flight. */
      const [rechecking, setRechecking] = useState(false);
      // `useInput` is a hook, so it may only be called while rendering. The menu's
      // handlers run later, from a click, and calling it there is React error #321
      // ("invalid hook call") — measured, and it takes the whole panel down. So the
      // draft is read here and the handlers close over this render's value.
      const draftNow = typeof props.useInput === 'function'
        ? props.useInput((input) => (input !== null && typeof input === 'object' && typeof input.draft === 'string' ? input.draft : ''))
        : '';
      /** The open context menu: which entry, where, and what it is doing. */
      const [menu, setMenu] = useState(undefined);
      /** The detail sheet a menu action opened, and the inline rename draft. */
      const [detail, setDetail] = useState(undefined);
      const [renameDraft, setRenameDraft] = useState(undefined);
      const [menuBusy, setMenuBusy] = useState(false);

      // Diagnostics are opt-in and bounded to this panel's lifetime: nothing
      // reaches `window` unless `localStorage['kdocs-debug'] === '1'` asked for
      // it, what it publishes carries no drive content, and the handle is removed
      // on unmount instead of being left holding a listing for every other page
      // script to read.
      useEffect(() => {
        if (!kdocsDebugEnabled()) return undefined;
        try {
          window.__kdocsPanelDebug = () => summarisePanelState(stateRef.current, lastErrorRef.current);
        } catch {
          return undefined;
        }
        return () => {
          try {
            delete window.__kdocsPanelDebug;
          } catch {
            /* a page may forbid it; diagnostics only */
          }
        };
      }, []);

      // A debounce still pending when the tab closes would fire into a dead panel.
      useEffect(() => () => {
        if (searchTimerRef.current !== undefined) clearTimeout(searchTimerRef.current);
      }, []);

      /** Fetch one level's first page. */
      /**
       * Fetch the root listing.
       *
       * `force` exists because the guard cannot tell "already loaded" from "already
       * tried and failed": a failed attempt leaves the level in place with an
       * error, so without it the retry button did nothing at all — the one control
       * offered to a user whose panel was empty.
       *
       * @param {boolean} [force] - fetch again even though a level already exists.
       */
      const loadRoot = useCallback(async (force) => {
        if (force !== true && stateRef.current.levels[ROOT_LEVEL] !== undefined) return;
        setState((current) => markLoading(current, ROOT_LEVEL));
        const result = await settleRemoteCall(() => face().list(undefined, undefined, signal), signal);
        // Abandoned because the tab closed: the pane is gone, so is the spinner.
        if (result === undefined) return;
        if (unwrapResult(result).ok === false) lastErrorRef.current = 'list(root)';
        // `replace` is not optional here. This one callback serves both the first
        // load AND the re-list of a level the panel already holds (`force`), and
        // the default is the paging *append*: without the flag a recheck or a
        // retry concatenates a second copy of the drive onto the list, which the
        // reader sees as the listing starting over at the bottom.
        setState((current) => applyListResult(current, ROOT_LEVEL, result, true));
      }, [props, signal]);

      /** Fetch the next page of one already-open level. */
      const loadMore = useCallback(
        async (key, parent) => {
          const level = stateRef.current.levels[key];
          if (level === undefined || level.cursor === undefined) return;
          const result = await settleRemoteCall(() => face().list(parent, level.cursor, signal), signal);
          if (result === undefined) return;
          if (unwrapResult(result).ok === false) lastErrorRef.current = 'list(more)';
          setState((current) => applyListResult(current, key, result));
        },
        [props, signal],
      );

      const onToggle = useCallback(
        async (entry, key) => {
          const outcome = toggleFolder(stateRef.current, key);
          setState(outcome.state);
          if (!outcome.shouldLoad) return;
          setState((current) => markLoading(current, key));
          const result = await settleRemoteCall(() => face().list(entry.ref, undefined, signal), signal);
          if (result === undefined) return;
          if (unwrapResult(result).ok === false) lastErrorRef.current = 'list(folder)';
          setState((current) => applyListResult(current, key, result));
        },
        [props, signal],
      );

      const onOpen = useCallback(
        (entry) => {
          const address = props.addressOf(entry.ref);
          tabActions.openResource(address);
        },
        [props, tabActions],
      );

      /**
       * Search, with the last keystroke winning.
       *
       * Every keystroke used to start a call whose result was applied whenever it
       * happened to land, so a slow early response could overwrite a newer one,
       * and a burst of typing became a burst of CLI invocations against a
       * rate-limited backend. The sequence number is what actually settles the
       * race; the debounce only reduces the traffic.
       *
       * `scope` is a parameter rather than a read of `stateRef.current`: the scope
       * buttons call this in the same tick as the `setState` that changes the scope,
       * and `stateRef` still holds the previous render's value there. Reading it back
       * made every switch search with the *previous* field — a one-off-by-one that
       * looked like "the filter does nothing" on the first click.
       *
       * @param {string} query - the current input value.
       * @param {string} [cursor] - a further page of this same query.
       * @param {string} [scope] - which field to match; defaults to the current choice.
       */
      const runSearch = useCallback(
        async (query, cursor, scope) => {
          const seq = searchSeqRef.current + 1;
          searchSeqRef.current = seq;
          setState((current) => ({ ...current, query, search: { ...current.search, active: true, loading: true } }));
          if (query.trim() === '') {
            setState((current) => ({ ...current, search: { active: false, loading: false, entries: [], cursor: undefined, total: undefined, error: undefined } }));
            return;
          }
          const result = await settleRemoteCall(
            () => face().search(
              query,
              cursor,
              { type: scope ?? stateRef.current.searchScope, withTotal: true },
              signal,
            ),
            signal,
          );
          // A newer keystroke owns the panel now; this response is stale.
          if (result === undefined || seq !== searchSeqRef.current) return;
          if (unwrapResult(result).ok === false) lastErrorRef.current = 'search';
          setState((current) => applySearchResult(current, result, cursor !== undefined));
        },
        [props, signal],
      );

      /** Ask for the next page of the query already on screen. */
      const loadMoreSearch = useCallback(
        async () => {
          const { query, search } = stateRef.current;
          if (search.cursor === undefined) return;
          await runSearch(query, search.cursor);
        },
        [runSearch],
      );

      /**
       * Switch the left-hand tabs, loading a view the first time it is opened.
       *
       * Loaded once and kept: these are the drive's own lists, they change slowly,
       * and re-fetching on every tab click would spend quota to re-render the same
       * rows. The tree is never re-fetched by a tab switch at all.
       *
       * @param {string} view - `'tree'` for the folder tree, else a `KDocsView`.
       */
      const openView = useCallback(
        async (view) => {
          // A view and a search answer the same question, so opening one clears
          // the other rather than leaving two lists stacked.
          //
          // Two things must be cleared for that to be true, not one: the in-flight
          // search is invalidated (a late response must not reactivate the search
          // pane over the view the user just chose), and `active` is dropped —
          // `searching` reads it, so leaving it set would show the emptied search
          // pane ("没有匹配的文档") instead of the view that was just fetched.
          searchSeqRef.current += 1;
          setState((current) => ({
            ...current,
            view,
            search: { ...current.search, active: false, entries: [], cursor: undefined, error: undefined },
          }));
          if (view === 'tree') return;
          if (stateRef.current.views[view] !== undefined) return;
          setState((current) => ({
            ...current,
            views: {
              ...current.views,
              [view]: { entries: [], cursor: undefined, loading: true, error: undefined },
            },
          }));
          const result = await settleRemoteCall(() => face().listView(view, undefined, signal), signal);
          if (result === undefined) return;
          if (unwrapResult(result).ok === false) lastErrorRef.current = `listView(${view})`;
          setState((current) => applyViewResult(current, view, result));
        },
        [props, signal],
      );

      /** Fetch one more page of whichever view is showing. */
      const loadMoreView = useCallback(
        async () => {
          const { view, views } = stateRef.current;
          const current = views[view];
          if (current === undefined || current.cursor === undefined) return;
          setState((state) => ({
            ...state,
            views: { ...state.views, [view]: { ...current, loading: true } },
          }));
          const result = await settleRemoteCall(() => face().listView(view, current.cursor, signal), signal);
          if (result === undefined) return;
          setState((state) => applyViewResult(state, view, result, true));
        },
        [props, signal],
      );

      // ── the right-click menu ─────────────────────────────────────────────
      //
      // This panel is session-scoped, so `inputActions` is already in props: the
      // quote writes straight into the composer with no bridge and no round trip.
      // The connectors that keep their browser in a root-scoped settings page need
      // a null-rendering dock entry purely to reach this; here it is one call.
      const canQuote = typeof props.inputActions?.setDraft === 'function';

      /** One entry's marker, built the same way the preview tab builds it. */
      const markerFor = (entry) => kdocsQuoteMarker(entry.name, props.addressOf(entry.ref));

      /** Write a marker into the composer, keeping whatever is already typed. */
      const writeMarker = (marker) => {
        const typed = typeof draftNow === 'string' ? draftNow.trim() : '';
        props.inputActions.setDraft(typed === '' ? marker : `${typed}\n\n${marker}`);
      };

      /** Re-list one already-loaded level in place, after its contents changed. */
      const refreshLevel = useCallback(
        async (key) => {
          const [driveId, fileId] = key === ROOT_LEVEL ? [] : key.split('/');
          const ref = driveId === undefined || fileId === undefined ? undefined : { driveId, fileId };
          const result = await settleRemoteCall(() => face().list(ref, undefined, signal), signal);
          if (result === undefined) return;
          setState((current) => applyListResult(current, key, result, true));
        },
        [props, signal],
      );

      /** Which loaded level holds this entry — the one a rename has to refresh. */
      const containingLevel = (ref) => Object.keys(stateRef.current.levels)
        .find((key) => stateRef.current.levels[key].entries
          .some((entry) => entry.ref.driveId === ref.driveId && entry.ref.fileId === ref.fileId));

      /** Open the menu at the pointer. Coordinates are clamped like the preview's
       *  selection button: a row near an edge would otherwise put it off-screen,
       *  which reads as "right-click did nothing". */
      const openMenu = useCallback((entry, event) => {
        const x = Math.min(Math.max(Number(event?.clientX ?? 0), 8), Math.max(window.innerWidth - 190, 8));
        const y = Math.min(Math.max(Number(event?.clientY ?? 0), 8), Math.max(window.innerHeight - 240, 8));
        setMenu({ entry, x, y });
      }, []);

      /** Run one menu action, with the busy flag and the menu dismissal handled once. */
      const runMenuAction = async (entry, action) => {
        setMenuBusy(true);
        try {
          await action(entry);
        } finally {
          setMenuBusy(false);
        }
      };

      const menuActions = {
        /** Quote — no network at all, which is why it is the first item. */
        quote: (entry) => {
          if (!canQuote) return;
          writeMarker(markerFor(entry));
          setDetail({ title: entry.name, note: t('quotedNote') });
          setMenu(undefined);
        },

        /** Open in a new tab. The link is fetched first because an anchor cannot
         *  be given a URL that is not known until after a round trip — and the
         *  fallback shows the link rather than silently doing nothing. */
        openOnline: async (entry) => {
          const result = await settleRemoteCall(() => face().getLink(entry.ref, signal), signal);
          const settled = result === undefined ? undefined : unwrapResult(result);
          const link = settled?.ok === true ? settled.value : undefined;
          setMenu(undefined);
          if (typeof link !== 'string' || link === '') return;
          try {
            window.open(link, '_blank', 'noreferrer');
          } catch {
            // A popup blocker is the expected failure; handing over the URL is the
            // honest degradation, not an error message.
          }
          setDetail({ title: entry.name, link, note: t('linkNote') });
        },

        copyLink: async (entry) => {
          const result = await settleRemoteCall(() => face().getLink(entry.ref, signal), signal);
          const settled = result === undefined ? undefined : unwrapResult(result);
          const link = settled?.ok === true ? settled.value : undefined;
          setMenu(undefined);
          if (typeof link !== 'string' || link === '') return;
          let copied = false;
          try {
            await window.navigator.clipboard.writeText(link);
            copied = true;
          } catch {
            copied = false;
          }
          setDetail({ title: entry.name, link, note: copied ? t('copiedNote') : t('linkNote') });
        },

        detail: async (entry) => {
          const result = await settleRemoteCall(() => face().stat(entry.ref, signal), signal);
          const settled = result === undefined ? undefined : unwrapResult(result);
          setMenu(undefined);
          if (settled?.ok !== true) {
            setDetail({ title: entry.name, note: settled?.error?.message ?? t('detailFailed') });
            return;
          }
          const value = settled.value ?? {};
          const lines = [
            `${t('detailKind')}: ${String(value.kind ?? '')}`,
            value.extension === undefined ? undefined : `${t('detailExt')}: .${String(value.extension)}`,
            value.modifiedAt === undefined ? undefined : `${t('detailModified')}: ${String(value.modifiedAt)}`,
            value.size === undefined ? undefined : `${t('detailSize')}: ${String(value.size)}`,
            `${t('detailAddress')}: ${props.addressOf(entry.ref)}`,
          ].filter((line) => line !== undefined);
          setDetail({ title: entry.name, lines });
        },

        versions: async (entry) => {
          const result = await settleRemoteCall(() => face().listVersions(entry.ref, signal), signal);
          const settled = result === undefined ? undefined : unwrapResult(result);
          setMenu(undefined);
          const lines = settled?.ok === true && Array.isArray(settled.value?.lines) ? settled.value.lines : undefined;
          if (lines === undefined) {
            setDetail({ title: entry.name, note: settled?.error?.message ?? t('versionsFailed') });
            return;
          }
          setDetail({ title: entry.name, note: lines.length === 0 ? t('versionsEmpty') : t('versionsNote'), lines });
        },

        comments: async (entry) => {
          const result = await settleRemoteCall(() => face().listComments(entry.ref, signal), signal);
          const settled = result === undefined ? undefined : unwrapResult(result);
          setMenu(undefined);
          const lines = settled?.ok === true && Array.isArray(settled.value?.lines) ? settled.value.lines : undefined;
          if (lines === undefined) {
            // The upstream refusal already reads as an explanation — "全文评论已关闭，
            // 请联系作者开启" — so it is shown as-is rather than reworded.
            setDetail({ title: entry.name, note: settled?.error?.message ?? t('commentsFailed') });
            return;
          }
          setDetail({ title: entry.name, note: lines.length === 0 ? t('commentsEmpty') : t('commentsNote'), lines });
        },

        /** Rename opens a draft rather than a dialog: it stays inside the panel,
         *  and the write only happens when the user confirms it. */
        rename: (entry) => {
          setMenu(undefined);
          // Pre-strip the extension only when the entry actually carries one.
          // `entry.extension` is set for files only (a folder named 案件.v1 has
          // none by design), and the Provider re-appends exactly that extension —
          // so stripping by regex here re-created the old data bug one layer up:
          // for a folder it deleted ".v1" from the draft and the rename landed as
          // 案件, a change the user never typed. (For a dotfile like `.gitignore`
          // the regex also produced an empty draft, which the commit then silently
          // ignored.)
          const stem = entry.extension === undefined
            ? entry.name
            : entry.name.slice(0, entry.name.length - entry.extension.length - 1);
          setRenameDraft({ ref: entry.ref, name: entry.name, value: stem });
        },
      };

      /** Apply a rename. The only write this plugin performs, and only from here. */
      const commitRename = async () => {
        const draft = renameDraft;
        if (draft === undefined || draft.value.trim() === '') return;
        setMenuBusy(true);
        const result = await settleRemoteCall(() => face().rename(draft.ref, draft.value.trim(), signal), signal);
        setMenuBusy(false);
        const settled = result === undefined ? undefined : unwrapResult(result);
        if (settled?.ok !== true) {
          setRenameDraft({ ...draft, error: settled?.error?.message ?? t('renameFailed') });
          return;
        }
        setRenameDraft(undefined);
        const key = containingLevel(draft.ref);
        if (key !== undefined) await refreshLevel(key);
      };

      /** Track the input immediately; issue the call once typing settles. */
      const onSearchInput = useCallback(
        (value) => {
          setState((current) => ({ ...current, query: value }));
          if (searchTimerRef.current !== undefined) {
            clearTimeout(searchTimerRef.current);
            searchTimerRef.current = undefined;
          }
          // Clearing the box is instant: there is nothing to wait for.
          if (value.trim() === '') {
            void runSearch(value);
            return;
          }
          searchTimerRef.current = setTimeout(() => {
            searchTimerRef.current = undefined;
            void runSearch(value);
          }, SEARCH_DEBOUNCE_MS);
        },
        [runSearch],
      );

      // Restore the user's place in the drive.
      //
      // The right sidebar unmounts this body when its tab closes, so without this
      // every reopen dropped back to a collapsed root with an empty search box —
      // and with a drive this size, "where was I" was the panel's most common
      // annoyance. Loaded *entries* are deliberately not persisted: a cached
      // listing would show stale names and defeat the point of a live drive. The
      // expanded folders and the query are, and their contents are re-fetched.
      useEffect(() => {
        const restored = stateRef.current;
        for (const key of Object.keys(restored.expanded)) {
          if (key === ROOT_LEVEL || restored.expanded[key] !== true) continue;
          if (restored.levels[key] !== undefined) continue;
          // The key is the identity the panel itself built, so the folder can be
          // asked for again without keeping a second copy of the tree.
          const [driveId, fileId] = key.split('/');
          if (!driveId || !fileId) continue;
          setState((current) => markLoading(current, key));
          void settleRemoteCall(() => face().list({ driveId, fileId }, undefined, signal), signal)
            .then((result) => {
              if (result === undefined) return;
              // `replace`, for the same reason `loadRoot` needs it: this fills a
              // level that is about to be shown whole, and the append default is
              // what paging is for.
              setState((current) => applyListResult(current, key, result, true));
            });
        }
        if (restored.query.trim() !== '') void runSearch(restored.query);
        // Mount only: this restores a place from a previous mount, so it must not
        // re-run when the values it reads happen to change.
      }, []);

      // Remember that place for the next mount.
      useEffect(() => {
        panelMemory.expanded = state.expanded;
        panelMemory.query = state.query;
      }, [state.expanded, state.query]);

      // The root listing opens with the tab; `signal` cancels it when the tab closes.
      useEffect(() => {
        if (signal.aborted) return;
        void loadRoot();
      }, [loadRoot, signal]);

      if (state.needsLogin) {
        // No credential passes through this plugin, by design. `kdocs-cli` owns the
        // token in the system keychain, and the one path that could have brought a
        // secret through here — a pasted token, with a stdin pipe added to the CLI
        // runner just for it — was removed for that reason. So a signed-out user is
        // told what to run instead of offered a field to type a secret into.
        const recheck = async () => {
          setRechecking(true);
          const result = await settleRemoteCall(() => face().status(signal), signal);
          setRechecking(false);
          if (result === undefined) return;
          const settled = unwrapResult(result);
          if (settled.ok !== true || settled.value?.authenticated !== true) return;
          setState((current) => ({ ...current, needsLogin: false }));
          // The listing only failed for want of a credential; ask for it again.
          void loadRoot(true);
        };

        return jsx('div', {
          'data-kdocs-state': 'not-authenticated',
          style: { padding: '12px' },
          children: [
            jsx('p', {
              key: 'msg',
              style: { fontSize: '12.5px', margin: '0 0 10px' },
              children: t('notAuthenticated'),
            }),
            jsx('pre', {
              key: 'steps',
              'data-kdocs-login-steps': 'true',
              style: {
                margin: '0 0 10px',
                padding: '8px 10px',
                fontSize: '11.5px',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                background: 'var(--dsw-alias-bg-layer-2)',
                border: '0.5px solid var(--dsw-alias-border-l3)',
                borderRadius: '6px',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              },
              children: t('loginSteps'),
            }),
            jsx('button', {
              key: 'recheck',
              type: 'button',
              'data-kdocs-recheck': 'true',
              disabled: rechecking,
              onClick: () => void recheck(),
              style: {
                ...HEADER_ACTION_STYLE,
                cursor: rechecking ? 'default' : 'pointer',
                opacity: rechecking ? 0.6 : 1,
              },
              children: rechecking ? t('rechecking') : t('recheck'),
            }),
          ],
        });
      }

      // A search pane is showing only when a search is actually active — NOT
      // whenever the box holds text. Reading the query made the box's content
      // decide what the list shows, so clicking a view tab with a query still in
      // the box fetched the view and then rendered the (already cleared) search
      // pane instead: the panel said 没有匹配的文档 while the view sat loaded and
      // invisible behind it.
      const searching = state.search.active;
      const rootLevel = state.levels[ROOT_LEVEL];

      /**
       * The left-hand tabs: the folder tree, then the drive's curated views.
       *
       * A flat list rather than a nested tree, because that is what these are —
       * the drive's own lists, with no parent to expand into.
       */
      const VIEW_TABS = [
        ['tree', t('viewTree')],
        ['starred', t('viewStarred')],
        ['recent', t('viewRecent')],
        ['sharedWithMe', t('viewSharedWithMe')],
        ['sharedByMe', t('viewSharedByMe')],
        ['trash', t('viewTrash')],
      ];

      const showingView = !searching && state.view !== 'tree';
      const activeView = state.views[state.view];

      /** Render a level's rows, recursing into expanded folders. */
      const renderLevel = (key, entries, depth) => {
        const nodes = [];
        for (const entry of entries) {
          const childKey = folderKey(entry.ref);
          // Rendered as an element, never called: the row owns hover state, and a
          // hook inside a plain function call attaches to the caller's hook list,
          // so a changing row count would desynchronise it (React #310).
          nodes.push(jsx(EntryRow, {
            key: childKey,
            entry,
            onMenu: openMenu,
            expanded: state.expanded,
            onToggle,
            onOpen,
            depth,
            t,
          }));
          if (entry.kind === 'directory' && state.expanded[childKey] === true) {
            const child = state.levels[childKey];
            if (child === undefined || child.loading) {
              nodes.push(jsx('div', { key: `${childKey}:loading`, style: { ...NOTE_STYLE, paddingLeft: noteIndent(depth + 1) }, children: t('loading') }));
            } else if (child.error !== undefined) {
              nodes.push(jsx('div', { key: `${childKey}:error`, style: { ...NOTE_STYLE, paddingLeft: noteIndent(depth + 1), color: 'var(--dsw-alias-label-secondary)' }, children: child.error.message }));
            } else if (child.entries.length === 0) {
              nodes.push(jsx('div', { key: `${childKey}:empty`, style: { ...NOTE_STYLE, paddingLeft: noteIndent(depth + 1) }, children: t('empty') }));
            } else {
              nodes.push(renderLevel(childKey, child.entries, depth + 1));
              if (child.cursor !== undefined) {
                nodes.push(jsx('button', {
                  key: `${childKey}:more`,
                  type: 'button',
                  onClick: () => void loadMore(childKey, entry.ref),
                  style: { ...ROW_STYLE, width: 'auto', marginLeft: `${String((depth + 1) * Number.parseInt(ROW_METRICS.indent, 10) + Number.parseInt(SPACE.sm, 10))}px`, color: 'var(--dsw-alias-label-tertiary)' },
                  children: t('loadMore'),
                }));
              }
            }
          }
        }
        return nodes;
      };

      const body = [];

      if (showingView) {
        // Curated views are flat: no expansion, no indentation, and the rows are
        // the same `EntryRow` the tree uses, so a file behaves identically in both.
        if (activeView === undefined || activeView.loading) {
          body.push(jsx('div', { key: 'view-loading', style: NOTE_STYLE, children: t('loading') }));
        } else if (activeView.error !== undefined) {
          body.push(jsx('div', { key: 'view-error', style: { ...NOTE_STYLE, color: 'var(--dsw-alias-label-secondary)' }, children: activeView.error.message }));
        } else if (activeView.entries.length === 0) {
          body.push(jsx('div', { key: 'view-empty', style: NOTE_STYLE, children: t('empty') }));
        } else {
          body.push(jsx('div', {
            key: 'view-entries',
            children: activeView.entries.map((entry, index) => jsx(EntryRow, {
              key: `${folderKey(entry.ref)}:${String(index)}`,
              entry,
              onMenu: openMenu,
              expanded: {},
              onToggle,
              onOpen,
              depth: 0,
              t,
            })),
          }));
          if (activeView.cursor !== undefined) {
            body.push(jsx('button', {
              key: 'view-more',
              type: 'button',
              'data-kdocs-more': 'view',
              onClick: () => void loadMoreView(),
              style: { ...ROW_STYLE, width: 'auto', color: 'var(--dsw-alias-label-tertiary)' },
              children: t('loadMore'),
            }));
          }
        }
      } else if (searching) {
        const shown = state.search.entries.length;
        const grand = state.search.total;
        body.push(jsx('div', {
          key: 'search-label',
          'data-kdocs-search-count': grand === undefined ? String(shown) : String(grand),
          style: { ...NOTE_STYLE, padding: `${SPACE.xs} ${SPACE.md}` },
          // A page used to end at 100 with nothing said about the rest, so "is that
          // everything?" had no answer on screen.
          children: grand === undefined
            ? `${t('searchResults')} · ${String(shown)}`
            : grand <= shown
              ? `${t('searchResults')} · ${String(grand)}`
              : `${t('searchResults')} · ${String(shown)} / ${String(grand)}`,
        }));
        if (state.search.loading) body.push(jsx('div', { key: 'search-loading', style: NOTE_STYLE, children: t('loading') }));
        else if (state.search.error !== undefined) body.push(jsx('div', { key: 'search-error', style: { ...NOTE_STYLE, color: 'var(--dsw-alias-label-secondary)' }, children: state.search.error.message }));
        else if (state.search.entries.length === 0) body.push(jsx('div', { key: 'search-empty', style: NOTE_STYLE, children: t('noResults') }));
        else body.push(jsx('div', {
          key: 'search-results',
          children: state.search.entries.map((entry, index) => jsx(EntryRow, {
            key: folderKey(entry.ref) + String(index),
            entry,
            onMenu: openMenu,
            expanded: {},
            onToggle,
            onOpen,
            depth: 0,
            t,
          })),
        }));
        // The CLI routinely matches more than one page for a common term, so a
        // truncated result set is the normal case rather than an edge one.
        if (!state.search.loading && state.search.error === undefined && state.search.cursor !== undefined) {
          body.push(jsx('button', {
            key: 'search-more',
            type: 'button',
            'data-kdocs-more': 'search',
            onClick: () => void loadMoreSearch(),
            style: { ...ROW_STYLE, width: 'auto', color: 'var(--dsw-alias-label-tertiary)' },
            children: t('loadMore'),
          }));
        }
      } else if (rootLevel === undefined || rootLevel.loading) {
        body.push(jsx('div', { key: 'root-loading', style: NOTE_STYLE, children: t('loading') }));
      } else if (rootLevel.error !== undefined) {
        body.push(jsx('div', {
          key: 'root-error',
          children: [
            jsx('div', { key: 'msg', style: { ...NOTE_STYLE, padding: 0, color: 'var(--dsw-alias-label-secondary)', marginBottom: '4px' }, children: rootLevel.error.message }),
            jsx('button', { key: 'retry', type: 'button', onClick: () => void loadRoot(true), style: { ...ROW_STYLE, width: 'auto', color: 'var(--dsw-alias-label-tertiary)' }, children: t('retry') }),
          ],
        }));
      } else if (rootLevel.entries.length === 0) {
        body.push(jsx('div', { key: 'root-empty', style: NOTE_STYLE, children: t('empty') }));
      } else {
        body.push(jsx('div', { key: 'root', children: renderLevel(ROOT_LEVEL, rootLevel.entries, 0) }));
        if (rootLevel.cursor !== undefined) {
          body.push(jsx('button', {
            key: 'root-more',
            type: 'button',
            onClick: () => void loadMore(ROOT_LEVEL, undefined),
            style: { ...ROW_STYLE, width: 'auto', color: 'var(--dsw-alias-label-tertiary)' },
            children: t('loadMore'),
          }));
        }
      }

      // Children are passed as a prop rather than as the variadic third
      // argument: the container committed to the DOM with zero children in the
      // page, while every leaf inside `body` was built correctly, so the
      // explicit prop form is what actually gets rendered.
      return jsxs('div', {
        'data-kdocs-panel': 'true',
        style: PANEL_STYLE,
        children: [
          // The field is its own row so it stays put while the tree scrolls; before
          // this it scrolled away with the list.
          // Item 3: the drive home. The root itself has no file id, and the root
          // listing carries no `link_url` (measured), so `latest` is the only honest
          // target — it is the cloud drive's own home page.
          // An anchor rather than a button: the target is a constant, so nothing
          // asynchronous happens on click and the browser treats it as a plain
          // navigation instead of a popup to block.
          jsx('div', {
            key: 'homeRow',
            style: { display: 'flex', alignItems: 'center', gap: SPACE.sm, flex: 'none', padding: `${SPACE.md} ${SPACE.md} 0` },
            children: [
              jsx('span', { key: 'label', style: { flex: '1 1 auto', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' }, children: t('rootLabel') }),
              jsx('a', {
                key: 'home',
                'data-kdocs-home': 'true',
                href: KDOCS_HOME_URL,
                target: '_blank',
                rel: 'noreferrer',
                style: HEADER_ACTION_STYLE,
                children: t('openInKDocs'),
              }),
            ],
          }),
          // The scope control sits inside the search row rather than under it. 0.2
          // stacked the field and then a second row of three pills, which is the
          // extra visual layer §6.2 objects to; the segmented control below reads as
          // one trailing affordance of the field, and one fewer line of chrome is
          // one more file row on screen.
          jsxs('div', {
            key: 'searchRow',
            style: { flex: 'none', display: 'flex', alignItems: 'center', gap: SPACE.sm, padding: `${SPACE.sm} ${SPACE.md} 0` },
            children: [
              jsx('input', {
                key: 'field',
                type: 'search',
                value: state.query,
                placeholder: t('searchPlaceholder'),
                'data-kdocs-search': 'true',
                onChange: (event) => onSearchInput(event.target.value),
                style: SEARCH_STYLE,
              }),
              // Which field the query matches. A legal user often remembers the
              // wording of a clause rather than a file name, and "content" is the
              // only way to reach that — the CLI supports it and the drive is
              // mostly prose. §6.1 forbids weakening it, so all three remain.
              jsx('div', {
                key: 'scopeRow',
                'data-kdocs-scope-row': 'true',
                role: 'group',
                'aria-label': t('scopeAll'),
                style: { display: 'flex', alignItems: 'center', gap: SPACE.lg, flex: 'none' },
                children: [['all', t('scopeAll')], ['file_name', t('scopeName')], ['content', t('scopeContent')]]
                  .map(([id, label]) => jsx('button', {
                    key: id,
                    type: 'button',
                    'data-kdocs-scope': id,
                    'aria-pressed': state.searchScope === id ? 'true' : 'false',
                    onClick: () => {
                      setState((current) => ({ ...current, searchScope: id }));
                      // Re-run so the choice applies to what is already on screen,
                      // rather than only to the next keystroke.
                      if (stateRef.current.query.trim() !== '') void runSearch(stateRef.current.query, undefined, id);
                    },
                    style: state.searchScope === id ? TAB_ACTIVE_STYLE : TAB_STYLE,
                    children: label,
                  })),
              }),
            ],
          }),
          // The drive's views, as navigation rather than as a row of buttons.
          //
          // 0.2 made each of the six a bordered pill, and at a narrow sidebar they
          // wrapped onto two lines — nine capsules at the top of the panel, which is
          // precisely the "button → button → button" the brief rules out. The active
          // state is now an underline; the row stays one line by tightening the gaps
          // and dropping the per-tab border, and every view keeps its own entry
          // (a `···` overflow menu was considered and rejected: hiding 回收站 behind
          // another click to save a line is the wrong trade in a workspace).
          jsx('div', {
            key: 'viewTabs',
            'data-kdocs-view-tabs': 'true',
            role: 'tablist',
            // The row scrolls rather than wraps, and that is the whole point: a
            // wrapped tab row silently becomes two lines (it did at 316px in 0.2),
            // which costs a file row and violates §16's "no core control goes from
            // one line to two". Measured across 280–480px, the six entries fit one
            // line from 320px up, and below that the row scrolls.
            //
            // The scrollbar is hidden, and that is load-bearing rather than
            // cosmetic: a container scrollbar occupies the padding box, and the row
            // measured 36px instead of 28px at 280px purely because of it. Hidden,
            // the row is exactly one control tall at every width, and a wheel or
            // trackpad still reaches the last entry.
            style: {
              display: 'flex',
              flexWrap: 'nowrap',
              gap: SPACE.lg,
              flex: 'none',
              overflowX: 'auto',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              padding: `${SPACE.md} ${SPACE.md} 0 ${SPACE.md}`,
            },
            children: VIEW_TABS.map(([id, label]) => jsx('button', {
              key: id,
              type: 'button',
              role: 'tab',
              'data-kdocs-view': id,
              // A search answers the same question a view does, so it takes the
              // highlight: two tabs lit at once would misstate what is on screen.
              'data-kdocs-view-active': !searching && state.view === id ? 'true' : 'false',
              'aria-selected': !searching && state.view === id ? 'true' : 'false',
              onClick: () => void openView(id),
              style: !searching && state.view === id ? TAB_ACTIVE_STYLE : TAB_STYLE,
              children: label,
            })),
          }),
          // The menu, the detail sheet and the rename draft all float above the
          // list. `position: fixed` puts them outside the scroll container, so a
          // long tree cannot clip them.
          menu === undefined
            ? null
            : jsx('div', {
              key: 'menuBackdrop',
              'data-kdocs-menu-backdrop': 'true',
              // A full-screen catcher: the menu closes on the next click anywhere,
              // which is the behaviour a context menu is expected to have.
              onClick: () => setMenu(undefined),
              onContextMenu: (event) => { event.preventDefault(); setMenu(undefined); },
              style: { position: 'fixed', inset: 0, zIndex: 49 },
            }),
          menu === undefined
            ? null
            : jsxs('div', {
              key: 'menu',
              'data-kdocs-menu': folderKey(menu.entry.ref),
              role: 'menu',
              style: { ...MENU_STYLE, left: `${String(menu.x)}px`, top: `${String(menu.y)}px` },
              children: [
                jsx('div', { key: 'head', style: MENU_HEAD_STYLE, children: menu.entry.name }),
                jsx('button', { key: 'quote', type: 'button', role: 'menuitem', 'data-kdocs-menu-item': 'quote', disabled: !canQuote || menuBusy, onClick: () => void runMenuAction(menu.entry, menuActions.quote), style: { ...MENU_ITEM_STYLE, opacity: canQuote ? 1 : 0.45 }, children: t('menuQuote') }),
                jsx('button', { key: 'open', type: 'button', role: 'menuitem', 'data-kdocs-menu-item': 'open', disabled: menuBusy, onClick: () => void runMenuAction(menu.entry, menuActions.openOnline), style: MENU_ITEM_STYLE, children: t('menuOpen') }),
                jsx('div', { key: 'sep-1', role: 'separator', style: MENU_SEPARATOR_STYLE }),
                jsx('button', { key: 'copy', type: 'button', role: 'menuitem', 'data-kdocs-menu-item': 'copy', disabled: menuBusy, onClick: () => void runMenuAction(menu.entry, menuActions.copyLink), style: MENU_ITEM_STYLE, children: t('menuCopyLink') }),
                jsx('button', { key: 'detail', type: 'button', role: 'menuitem', 'data-kdocs-menu-item': 'detail', disabled: menuBusy, onClick: () => void runMenuAction(menu.entry, menuActions.detail), style: MENU_ITEM_STYLE, children: t('menuDetail') }),
                jsx('button', { key: 'versions', type: 'button', role: 'menuitem', 'data-kdocs-menu-item': 'versions', disabled: menuBusy, onClick: () => void runMenuAction(menu.entry, menuActions.versions), style: MENU_ITEM_STYLE, children: t('menuVersions') }),
                jsx('button', { key: 'comments', type: 'button', role: 'menuitem', 'data-kdocs-menu-item': 'comments', disabled: menuBusy, onClick: () => void runMenuAction(menu.entry, menuActions.comments), style: MENU_ITEM_STYLE, children: t('menuComments') }),
                jsx('div', { key: 'sep-2', role: 'separator', style: MENU_SEPARATOR_STYLE }),
                jsx('button', { key: 'rename', type: 'button', role: 'menuitem', 'data-kdocs-menu-item': 'rename', disabled: menuBusy, onClick: () => menuActions.rename(menu.entry), style: MENU_ITEM_STYLE, children: t('menuRename') }),
              ],
            }),
          renameDraft === undefined
            ? null
            : jsx('div', {
              key: 'renameDraft',
              'data-kdocs-rename': 'true',
              style: { margin: '6px 10px 0', padding: '8px 10px', border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)', flex: 'none' },
              children: [
                jsx('div', { key: 'label', style: { fontSize: '11.5px', marginBottom: '6px', color: 'var(--dsw-alias-label-secondary)' }, children: t('renameLabel') }),
                jsx('input', {
                  key: 'input',
                  type: 'text',
                  value: renameDraft.value,
                  'data-kdocs-rename-input': 'true',
                  autoFocus: true,
                  onChange: (event) => setRenameDraft({ ...renameDraft, value: event.target.value, error: undefined }),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') void commitRename();
                    if (event.key === 'Escape') setRenameDraft(undefined);
                  },
                  style: { ...SEARCH_STYLE, marginBottom: '6px' },
                }),
                jsx('div', { key: 'actions', style: { display: 'flex', gap: SPACE.sm } },
                  jsx('button', { key: 'ok', type: 'button', 'data-kdocs-rename-commit': 'true', disabled: menuBusy, onClick: () => void commitRename(), style: { ...HEADER_ACTION_STYLE, textAlign: 'left', padding: `${SPACE.xs} ${SPACE.md}`, font: 'inherit', width: 'auto', border: '0.5px solid var(--dsw-alias-border-l3)' }, children: menuBusy ? t('renameBusy') : t('renameCommit') }),
                  jsx('button', { key: 'cancel', type: 'button', 'data-kdocs-rename-cancel': 'true', onClick: () => setRenameDraft(undefined), style: { ...HEADER_ACTION_STYLE, textAlign: 'left', padding: `${SPACE.xs} ${SPACE.md}`, font: 'inherit', width: 'auto', border: '0.5px solid var(--dsw-alias-border-l3)' }, children: t('renameCancel') }),
                ),
                renameDraft.error === undefined
                  ? null
                  : jsx('div', { key: 'err', 'data-kdocs-rename-error': renameDraft.error, style: { marginTop: '6px', fontSize: '11.5px', color: 'var(--dsw-alias-state-error-primary)' }, children: renameDraft.error }),
              ],
            }),
          detail === undefined
            ? null
            : jsx('div', {
              key: 'detail',
              'data-kdocs-detail': detail.title,
              style: { margin: '6px 10px 0', padding: '8px 10px', border: '0.5px solid var(--dsw-alias-border-l3)', borderRadius: '8px', background: 'var(--dsw-alias-bg-layer-2)', flex: 'none' },
              children: [
                jsx('div', { key: 'head', style: { display: 'flex', alignItems: 'baseline', gap: '8px' } },
                  jsx('span', { key: 'title', style: { flex: '1 1 auto', fontSize: '12px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: detail.title }),
                  jsx('button', { key: 'close', type: 'button', 'data-kdocs-detail-close': 'true', onClick: () => setDetail(undefined), style: { ...HEADER_ACTION_STYLE, padding: '1px 7px' }, children: t('detailClose') }),
                ),
                detail.note === undefined
                  ? null
                  : jsx('div', { key: 'note', style: { marginTop: '4px', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary)' }, children: detail.note }),
                ...(detail.lines === undefined ? [] : detail.lines.map((line, index) => jsx('div', { key: `line-${String(index)}`, style: { fontSize: '11.5px', wordBreak: 'break-all' }, children: line }))),
                detail.link === undefined
                  ? null
                  : jsx('div', { key: 'link', 'data-kdocs-detail-link': detail.link, style: { marginTop: '4px', fontSize: '11px', wordBreak: 'break-all', color: 'var(--dsw-alias-label-tertiary)' }, children: detail.link }),
              ],
            }),
          jsx('div', {
            key: 'list',
            style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: `0 ${SPACE.xs} ${SPACE.md}` },
            children: body,
          }),
        ],
      });
    }

    /**
     * Render one slot body, showing its failure instead of vanishing.
     *
     * A throw inside a slot body is swallowed by the slot runtime — the pane simply
     * comes up empty, which is indistinguishable from "nothing to show" and cost
     * real time to diagnose. This keeps the fault on screen.
     *
     * **This has to be a real React error boundary, and 0.2.5 proved why.** The first
     * version of this function wrapped the body in a `try`/`catch`, which only ever
     * saw a throw from the body's *own* synchronous call. Anything thrown while React
     * reconciled a **child** — a row, a menu, a preview — unwound straight past it
     * into the slot runtime, which replaced the whole pane with an empty div. That is
     * how a `ReferenceError` in one hovered file row turned the entire sidebar white
     * while this boundary sat right there reporting nothing: it was never in the
     * call path. A class with `getDerivedStateFromError` is in the path by
     * construction.
     *
     * @param {any} Component - the body component.
     * @returns {any} a component that renders either the body or its error.
     */
    function guarded(Component) {
      class Guarded extends react.Component {
        /**
         * @param {any} props - the seat props passed through to the body.
         */
        constructor(props) {
          super(props);
          this.state = { error: undefined };
        }

        /** @param {any} error - what a descendant threw. @returns {any} the new state. */
        static getDerivedStateFromError(error) {
          return { error };
        }

        /**
         * @returns {any} the body, or the failure that replaced it.
         */
        render() {
          if (this.state.error === undefined) return jsx(Component, this.props);
          const message = String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error);
          const stack = String((this.state.error && this.state.error.stack) || '').split('\n').slice(0, 4).join('\n');
          return jsx('div', {
            'data-kdocs-error': 'true',
            style: { padding: '12px 10px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap' },
            children: `${Component.name || 'kdocs'} 渲染失败：${message}\n\n${stack}`,
          });
        }
      }
      Guarded.displayName = `Guarded(${Component.name || 'kdocs'})`;
      return Guarded;
    }

    /**
     * Concatenate the text of a settled call's content blocks.
     *
     * @param {unknown} blocks - the call's content blocks.
     * @returns {string} the text they carry.
     */
    function toolResultText(blocks) {
      if (!Array.isArray(blocks)) return '';
      return blocks
        .map((block) => (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
        .filter((piece) => piece !== '')
        .join('\n');
    }

    /**
     * The document handle a call named, wherever it named it.
     *
     * Both sources are real and neither is redundant: `address` appears in the
     * arguments only when the caller quoted a document, while every tool's rendered
     * result ends with the address it resolved — the only source for a call that
     * used `ref`.
     *
     * @param {unknown} argsRaw - the call's raw argument JSON.
     * @param {string} text - the rendered result.
     * @returns {string | undefined} the address, when there is one.
     */
    function toolResultAddress(argsRaw, text) {
      if (typeof argsRaw === 'string') {
        try {
          const parsed = JSON.parse(argsRaw);
          if (parsed !== null && typeof parsed === 'object' && typeof parsed.address === 'string'
            && parseKDocsLocator(parsed.address) !== undefined) {
            return parsed.address.trim();
          }
        } catch {
          // A call still streaming has partial arguments; the result text below
          // carries the address once it settles.
        }
      }
      const found = /dsh-resource:\/\/kdocs\/file\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/.exec(text);
      return found === null ? undefined : found[0];
    }

    /**
     * The card a settled `kdocs_*` Tool call renders as.
     *
     * The generic tool row already shows the text these tools produce, so the card
     * only adds what the row cannot: **which document this was**, and how to point
     * at it again. A read result is otherwise a wall of Markdown with no visible
     * identity, and the identity is what a reader wants to confirm before trusting
     * the body.
     *
     * The name comes from the rendered result rather than the arguments, because a
     * call addressed by `ref` never carries one — and the tool's render already
     * leads with it.
     *
     * @param {any} props - the owner's call props.
     * @returns {any} the rendered card.
     */
    function KDocsToolView(props) {
      // `t` must come from the seat, not from this module: the bound locale
      // function lives in `apply`'s scope, so reaching for a bare `t` here is a
      // ReferenceError — and it only fires on the error branch, which is exactly
      // the branch nobody exercises until a `kdocs_*` call fails.
      const { block, toolName, t } = props;
      const settled = block !== null && typeof block === 'object' && block.kind === 'tool-result' ? block : undefined;
      const argsRaw = settled?.call?.argsRaw ?? (block !== null && typeof block === 'object' ? block.argsRaw : undefined);
      const text = toolResultText(settled?.content);

      const lines = text.split('\n');
      const headIndex = lines.findIndex((line) => line.trim() !== '');
      const heading = headIndex === -1 ? '' : lines[headIndex].replace(/^#\s*/, '').trim();
      const rest = headIndex === -1 ? '' : lines.slice(headIndex + 1).join('\n').replace(/^\n+/, '');
      const address = toolResultAddress(argsRaw, text);

      return jsx('div', {
        'data-kdocs-toolcard': toolName,
        style: { display: 'flex', flexDirection: 'column', gap: '6px' },
        children: [
          jsx('div', {
            key: 'head',
            style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' },
            children: [
              jsx('span', { key: 'name', style: { fontWeight: 600, fontSize: '12.5px' }, children: heading === '' ? toolName : heading }),
              settled?.isError === true
                ? jsx('span', {
                  key: 'error',
                  style: { fontSize: '11.5px', color: 'var(--dsw-alias-state-error-primary)' },
                  children: t('toolFailed'),
                })
                : null,
              address === undefined
                ? null
                : jsx('span', {
                  key: 'address',
                  'data-kdocs-toolcard-address': address,
                  // A monospace label rather than a link: the address is an
                  // identifier for this plugin, not something a browser can open.
                  style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '10.5px', opacity: 0.55, wordBreak: 'break-all' },
                  children: address,
                }),
            ],
          }),
          rest.trim() === ''
            ? null
            : jsx('div', {
              key: 'body',
              style: { fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '320px', overflow: 'auto', opacity: 0.9 },
              children: rest,
            }),
        ],
      });
    }

    /**
     * The chip title of a kdocs tab: fixed copy, so the seat only needs to render it.
     *
     * @param {any} props - seat props.
     * @returns {any} the rendered title.
     */
    function KDocsPanelTitle(props) {
      // One title component serves both kdocs tab kinds, chosen by the tab's own
      // kind: the panel is a page with fixed copy, a preview is a document, and its
      // chip should name the document rather than the id inside the address.
      const useTabInfo = props.useTabInfo;
      const tab = typeof useTabInfo === 'function' ? useTabInfo().tab : undefined;
      const isPreview = tab !== undefined && tab.kind === PREVIEW_KIND;

      if (!isPreview) {
        return jsx('span', { children: props.t('guideTitle') });
      }

      const address = tab.contentId;
      // The chip is only as live as this hook: the registry captured
      // `title(address)` when the tab opened, which the address alone answers with
      // an id. Subscribing to the resource here is what lets the real name arrive
      // once the metadata does and the seat re-render.
      const meta = typeof props.useResource === 'function' ? props.useResource(address) : undefined;
      const name = meta?.value?.name;
      return jsx('span', {
        'data-kdocs-chip': 'true',
        'data-kdocs-chip-source': name === undefined ? 'id' : 'name',
        children: name ?? kdocsNameOfAddress(address) ?? props.t('previewFallbackTitle'),
      });
    }

    /**
     * Mount the `kdocs` namespace for this plugin's lifetime.
     *
     * @param {any} ctx - the client root context.
     * @returns {Promise<void>} resolves once the namespace is callable.
     */
    /**
     * Mount the kdocs namespace, then register what depends on it.
     *
     * Cordis enforces its own dependency graph: reading `ctx.remote.kdocs`
     * *before* the namespace service exists does not merely yield `undefined`, it
     * marks the plugin's context as having touched an uninjected service and
     * throws from then on (`cannot get property "remote.kdocs" without inject`).
     * That is why nothing here touches `ctx.remote.kdocs` at activation time —
     * `ctx.inject` waits for the service and runs the body once it is there.
     *
     * The retry loop below is the fix for a reproduced wedge, not a precaution.
     * `dsh-client-hmr`'s reload drops the previous fiber with
     * `registry.delete(callback)` — which *starts* disposal but does not await it —
     * and then checks `oldFiber.inertia` before the disposal microtask has had the
     * chance to set it, so the wait is skipped entirely. The fresh fiber's
     * `$mount` can therefore reach the Remote service's mutation queue *ahead of*
     * the previous incarnation's unmount. When it does, the Gateway's
     * `validateContribution` sees the still-installed methods and throws
     * `client api: direct method kdocs/<method> is already mounted`; the doomed
     * unmount then runs anyway and withdraws `remote.kdocs` altogether, leaving
     * this fiber — and every `ctx.inject(['remote.kdocs'])` consumer — with no
     * namespace until the next reload. The panel rendered its skeleton (the
     * inject resolved against the about-to-die namespace) and then lost its body,
     * which is the permanently blank/loading pane this guards against.
     *
     * The competing unmount is guaranteed to be in flight — it is the only source
     * of "already mounted" — and both sides drain through the same serialized
     * mutation queue, so waiting briefly and retrying lands strictly after it and
     * mounts cleanly. Any other failure is a real defect and is left to throw.
     *
     * @param {any} ctx - the client root context.
     * @returns {Promise<void>} resolves once mounting has been handed to Cordis.
     */
    exports.apply = async function apply(ctx) {
      ctx.effect(async () => {
        /** @type {(() => Promise<void>) | undefined} */
        let dispose;
        for (let attempt = 0; ; attempt += 1) {
          try {
            dispose = await ctx.remote.$mount(TYPERT_REMOTE);
            break;
          } catch (error) {
            const retriable = /already mounted/.test(String(error && error.message));
            if (!retriable || attempt >= 9) throw error;
            // 50ms, 100ms, … 500ms — the losing unmount is microtasks away; this
            // ceiling (~2.75s total) only matters when the page is busy.
            await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
          }
        }
        return () => dispose();
      }, 'kdocs: mount the kdocs Remote namespace');

      // The panel's one stylesheet, and the only place a real CSS rule is needed.
      //
      // Everything else in this plugin is inline styles, which React owns and which
      // therefore cannot express a pseudo-element or a descendant selector. Two
      // things genuinely need CSS. First, `::-webkit-scrollbar`: the tab row hides
      // its scrollbar so the row cannot grow taller than one line, and
      // `scrollbar-width: none` does not reach a WebKit scrollbar on the Chromium
      // versions this ships against. Second, `:hover` and `:focus-visible` on the
      // menu items and the row's quick action — React has no `onHover`-style prop
      // for them, and the focus ring has to be distinguishable from the hover fill
      // (§17: "hover 与 selected 不能只靠颜色区分").
      //
      // Scoped by `[data-kdocs-…]` attributes rather than by a class prefix, so
      // nothing here can reach a product element, and owned by `ctx.effect` so it
      // goes away with the plugin.
      ctx.effect(() => {
        const style = document.createElement('style');
        style.setAttribute('data-kdocs-style', '0.2.5');
        style.textContent = [
          '[data-kdocs-view-tabs]::-webkit-scrollbar{display:none}',
          '[data-kdocs-menu-item]:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}',
          '[data-kdocs-menu-item]:focus-visible{outline:1.5px solid var(--dsw-alias-label-primary);outline-offset:-1.5px}',
          '[data-kdocs-row-menu]:hover{color:var(--dsw-alias-label-primary)}',
          '[data-kdocs-row-menu]:focus-visible{outline:1.5px solid var(--dsw-alias-label-primary);outline-offset:-1.5px}',
          '[data-kdocs-row]:focus-visible{outline:1.5px solid var(--dsw-alias-label-primary);outline-offset:-1.5px}',
          '[data-kdocs-mode]:hover{background:var(--dsw-alias-interactive-bg-hover)}',
          '[data-kdocs-scope]:hover,[data-kdocs-view]:hover{color:var(--dsw-alias-label-primary)}',
          '[data-kdocs-search]::placeholder{color:var(--dsw-alias-label-tertiary)}',
        ].join('');
        document.head.appendChild(style);
        return () => style.remove();
      }, 'kdocs: panel stylesheet');

      ctx.inject(['remote.kdocs'], (scoped) => {
        // The resource protocol: metadata for `dsh-resource://kdocs/file/...`.
        ctx.effect(() => {
          const release = ctx.resources.register(createKDocsResourceProvider(() => scoped.remote.kdocs));
          return () => release();
        }, 'kdocs: register the kdocs resource protocol');

        const t = ctx.locale.bind(KDOCS_NS);
        ctx.effect(() => ctx.locale.register(KDOCS_NS, { zh: KDOCS_ZH, en: KDOCS_EN }), 'kdocs: sidebar copy');
        ctx.effect(() => ctx.sidebarRightTabs.register(kdocsDefinition(t)), 'kdocs: kdocs-files tab type');

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: KDOCS_ID,
          locale: KDOCS_NS,
          // The seat spreads this factory's return value into the body's props.
          inject: () => ({
            remote: scoped.remote.kdocs,
            addressOf: kdocsAddressOf,
          }),
        }, guarded(KDocsBody))), 'kdocs: kdocs-files tab body');

        // One title registration covers both kinds: the seat dispatches by the type
        // in force, and both types share this component's id-space, so the panel and
        // the preview each get their own key.
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: KDOCS_ID,
          locale: KDOCS_NS,
        }, KDocsPanelTitle)), 'kdocs: kdocs-files tab title');

        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: PREVIEW_ID,
          locale: KDOCS_NS,
        }, KDocsPanelTitle)), 'kdocs: kdocs-preview tab title');

        // M6: the viewer that claims the addresses the panel emits.
        ctx.effect(() => ctx.sidebarRightTabs.register(kdocsPreviewDefinition(t)), 'kdocs: kdocs-preview tab type');
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: PREVIEW_ID,
          locale: KDOCS_NS,
          inject: () => ({ remote: scoped.remote.kdocs }),
        }, guarded(KDocsPreview))), 'kdocs: kdocs-preview tab body');

        // M8: the four tools get their own card.
        //
        // `tool.call.toolview`'s key domain is open — the product's own docs say so
        // — and it is dispatched by *wire Tool name*, so a package can claim its own
        // tools and nothing else. An unclaimed key falls back to the generic row,
        // which means registering here is additive and cannot break a shipped view.
        for (const tool of ['kdocs_list', 'kdocs_search', 'kdocs_stat', 'kdocs_read']) {
          ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
            name: 'tool.call.toolview',
            key: tool,
            locale: KDOCS_NS,
          }, guarded(KDocsToolView))), `kdocs: ${tool} card`);
        }
      });
    };

    exports.TYPERT_REMOTE = TYPERT_REMOTE;
    exports.parseKDocsAddress = parseKDocsAddress;
    exports.parseKDocsLocator = parseKDocsLocator;
    exports.kdocsAddressOf = kdocsAddressOf;
    exports.safeHref = safeHref;
    exports.inlineSpans = inlineSpans;
    exports.kdocsQuoteMarker = kdocsQuoteMarker;
    exports.toolResultText = toolResultText;
    exports.toolResultAddress = toolResultAddress;
    exports.KDocsToolView = KDocsToolView;
    exports.initialPanelState = initialPanelState;
    exports.restoredPanelState = restoredPanelState;
    exports.panelMemory = panelMemory;
    exports.applyListResult = applyListResult;
    exports.applySearchResult = applySearchResult;
    // The curated-view reducer, exported for the same reason its two siblings are:
    // a reducer nothing can call is a reducer nothing can test, and this one shipped
    // a dead end (a failed further page discarded the cursor the retry control needs)
    // through a release because of it.
    exports.applyViewResult = applyViewResult;
    exports.toggleFolder = toggleFolder;
    exports.markLoading = markLoading;
    exports.folderKey = folderKey;
    exports.ROOT_LEVEL = ROOT_LEVEL;
    exports.KDOCS_KIND = KDOCS_KIND;
    exports.KDOCS_ID = KDOCS_ID;
    exports.kdocsDefinition = kdocsDefinition;
    exports.KDocsBody = KDocsBody;
    // Exported for the same reason `KDocsBody` is: this surface had no render test
    // at all, and a release review demonstrated that an undefined name in its header
    // kept the whole suite green. The document view is the one a reader spends the
    // most time in, so "no test has ever executed it" is the gap worth closing.
    exports.KDocsPreview = KDocsPreview;
    exports.KDocsPanelTitle = KDocsPanelTitle;
    exports.kdocsPreviewDefinition = kdocsPreviewDefinition;
    exports.parseMarkdown = parseMarkdown;
    exports.inlineSpans = inlineSpans;
    exports.unwrapResult = unwrapResult;
    exports.guarded = guarded;
    // Exported so a test can render one row for real, with hover on. That is the
    // only way the quick-menu branch — the branch that shipped a `ReferenceError`
    // in 0.2.5 — is ever executed outside a browser.
    exports.EntryRow = EntryRow;
    // The type-glyph table and its two lookups. Exported so a test can hold the
    // bundle to its own promises — every kind painted, every suffix classified, and
    // no colour invented outside the product's token set — none of which a browser
    // screenshot can check.
    exports.FILE_ICONS = FILE_ICONS;
    exports.FILE_KINDS = FILE_KINDS;
    exports.fileKindOf = fileKindOf;
    exports.entryKindOf = entryKindOf;
    exports.FileIcon = FileIcon;
    exports.PREVIEW_KIND = PREVIEW_KIND;
    exports.PREVIEW_ID = PREVIEW_ID;
    exports.kdocsEmbedUrl = kdocsEmbedUrl;
    exports.createKDocsResourceProvider = createKDocsResourceProvider;

    return module.exports;
  },
});
