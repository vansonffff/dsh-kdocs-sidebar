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
        onClick: () => setMode(value),
        style: {
          ...HEADER_ACTION_STYLE,
          // The selection is carried by fill and weight rather than by size, so the
          // active control does not change the row's geometry when it moves.
          background: mode === value ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
          opacity: mode === value ? 1 : 0.7,
        },
        children: label,
      });

      const header = jsxs('div', {
        key: 'header',
        style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderBottom: '0.5px solid var(--dsw-alias-border-l3)', flex: '0 0 auto' },
        children: [
          jsx('div', { key: 'name', style: { flex: '1 1 auto', fontSize: '12.5px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: name }),
          modeButton('embed', t('modeEmbed')),
          modeButton('text', t('modeText')),
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
                src: embedUrl,
                title: name,
                'data-kdocs-embed': 'true',
                // The frame cannot be inspected across origins, so a failure is
                // silent by nature; the hint below is what tells a reader what to do
                // when they see a sign-in page instead of their document.
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
        views: { ...state.views, [view]: { ...current, loading: false, cursor: undefined, error } },
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
          cursor: undefined,
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

    /**
     * The panel's style vocabulary.
     *
     * Values are lifted from the product's own files panel rather than invented:
     * its rows are `border-radius: 10px`, `padding: 5px 10px`, `gap: 6px`, nested
     * levels indent by `18px`, and its header border is `0.5px`. Its colours are
     * the `--dsw-alias-*` design tokens, which is what makes it follow the theme —
     * hard-coded greys and reds do not, and were the main reason this panel looked
     * foreign next to Workspace files.
     *
     * Only tokens with a documented role are used:
     * `label-primary` (content), `label-secondary` (supporting), `label-tertiary`
     * (icons and metadata), `interactive-bg-hover` (hover), `border-l3` (dividers).
     */
    const ROW_STYLE = {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      width: '100%',
      minWidth: 0,
      // `font: inherit` matters: a <button> does not inherit font by default, so
      // without it the tree renders in the browser's UI font and reads as bolted-on.
      font: 'inherit',
      color: 'inherit',
      textAlign: 'left',
      cursor: 'pointer',
      background: 'none',
      border: 0,
      borderRadius: '10px',
      padding: '5px 10px',
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

    /** A search field that reads as part of the panel rather than a default input. */
    const SEARCH_STYLE = {
      width: '100%',
      boxSizing: 'border-box',
      fontSize: 'var(--dsh-content-font-size-secondary, 13px)',
      font: 'inherit',
      padding: '5px 10px',
      borderRadius: '10px',
      border: '0.5px solid var(--dsw-alias-border-l3)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      outline: 'none',
    };

    /** One muted line of status copy, like the files panel's own notes. */
    const NOTE_STYLE = {
      color: 'var(--dsw-alias-label-tertiary)',
      fontSize: '12px',
      margin: 0,
      padding: '3px 10px',
      lineHeight: 1.6,
    };

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
     */
    const HEADER_ACTION_STYLE = {
      font: 'inherit',
      fontSize: '12px',
      lineHeight: '18px',
      padding: '3px 9px',
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

    /**
     * Render one entry row.
     *
     * @param {any} entry - a `KDocsEntry`.
     * @param {any} options - row wiring.
     * @returns {any} the React element.
     */
    function EntryRow(options) {
      const { entry, depth } = options;
      const isFolder = entry.kind === 'directory';
      const key = folderKey(entry.ref);
      const open = options.expanded[key] === true;
      const [hover, setHover] = react.useState(false);

      // Children are passed as a prop, never as the variadic third argument: the
      // real jsx runtime dropped them that way and rows committed with no content.
      return jsx('div', {
        'data-kdocs-entry': entry.kind,
        // Indentation lives on the row, not on a wrapper, so the hover highlight
        // spans the full width exactly like the files panel's rows do.
        style: { paddingLeft: `${String(depth * 18)}px` },
        children: jsx('button', {
          type: 'button',
          title: entry.name,
          'data-kdocs-row': isFolder ? 'folder' : 'file',
          onClick: () => (isFolder ? options.onToggle(entry, key) : options.onOpen(entry)),
          // The row only reports the gesture; what the menu offers is the panel's
          // business, so a row stays renderable without a menu (search results,
          // which pass no handler, keep behaving exactly as before).
          onContextMenu: options.onMenu === undefined
            ? undefined
            : (event) => { event.preventDefault(); options.onMenu(entry, event); },
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: hover ? { ...ROW_STYLE, background: 'var(--dsw-alias-interactive-bg-hover)' } : ROW_STYLE,
          children: [
            jsx('span', {
              key: 'glyph',
              'aria-hidden': 'true',
              style: {
                flex: 'none',
                width: '14px',
                textAlign: 'center',
                fontSize: '10px',
                color: 'var(--dsw-alias-label-tertiary)',
              },
              children: isFolder ? (open ? '\u25be' : '\u25b8') : '',
            }),
            jsx('span', {
              key: 'name',
              style: {
                minWidth: 0,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                // A folder carries the full ink, a file the supporting tone, so the
                // container/file distinction reads at a glance.
                color: isFolder ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
              },
              children: entry.name,
            }),
          ],
        }),
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
          setRenameDraft({ ref: entry.ref, name: entry.name, value: entry.name.replace(/\.[^.]+$/, '') });
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

      const searching = state.query.trim() !== '';
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
          }));
          if (entry.kind === 'directory' && state.expanded[childKey] === true) {
            const child = state.levels[childKey];
            if (child === undefined || child.loading) {
              nodes.push(jsx('div', { key: `${childKey}:loading`, style: { ...NOTE_STYLE, paddingLeft: `${String((depth + 1) * 18 + 10)}px` }, children: t('loading') }));
            } else if (child.error !== undefined) {
              nodes.push(jsx('div', { key: `${childKey}:error`, style: { ...NOTE_STYLE, paddingLeft: `${String((depth + 1) * 18 + 10)}px`, color: 'var(--dsw-alias-label-secondary)' }, children: child.error.message }));
            } else if (child.entries.length === 0) {
              nodes.push(jsx('div', { key: `${childKey}:empty`, style: { ...NOTE_STYLE, paddingLeft: `${String((depth + 1) * 18 + 10)}px` }, children: t('empty') }));
            } else {
              nodes.push(renderLevel(childKey, child.entries, depth + 1));
              if (child.cursor !== undefined) {
                nodes.push(jsx('button', {
                  key: `${childKey}:more`,
                  type: 'button',
                  onClick: () => void loadMore(childKey, entry.ref),
                  style: { ...ROW_STYLE, width: 'auto', marginLeft: `${String((depth + 1) * 18)}px`, color: 'var(--dsw-alias-label-tertiary)' },
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
          style: { ...NOTE_STYLE, padding: '3px 10px 1px' },
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
            style: { display: 'flex', alignItems: 'center', gap: '6px', flex: 'none', padding: '8px 10px 0' },
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
          jsx('div', {
            key: 'searchRow',
            style: { flex: 'none', padding: '8px 10px 6px' },
            children: jsx('input', {
              type: 'search',
              value: state.query,
              placeholder: t('searchPlaceholder'),
              'data-kdocs-search': 'true',
              onChange: (event) => onSearchInput(event.target.value),
              style: SEARCH_STYLE,
            }),
          }),
          // Which field the query matches. A legal user often remembers the wording
          // of a clause rather than a file name, and "content" is the only way to
          // reach that — the CLI supports it and the drive is mostly prose.
          jsx('div', {
            key: 'scopeRow',
            'data-kdocs-scope-row': 'true',
            style: { display: 'flex', gap: '4px', flex: 'none', padding: '0 10px 6px' },
            children: [['all', t('scopeAll')], ['file_name', t('scopeName')], ['content', t('scopeContent')]]
              .map(([id, label]) => jsx('button', {
                key: id,
                type: 'button',
                'data-kdocs-scope': id,
                onClick: () => {
                  setState((current) => ({ ...current, searchScope: id }));
                  // Re-run so the choice applies to what is already on screen,
                  // rather than only to the next keystroke.
                  if (stateRef.current.query.trim() !== '') void runSearch(stateRef.current.query, undefined, id);
                },
                style: {
                  ...HEADER_ACTION_STYLE,
                  background: state.searchScope === id ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
                  opacity: state.searchScope === id ? 1 : 0.7,
                },
                children: label,
              })),
          }),
          jsx('div', {
            key: 'viewTabs',
            'data-kdocs-view-tabs': 'true',
            style: { display: 'flex', flexWrap: 'wrap', gap: '4px', flex: 'none', padding: '0 10px 6px' },
            children: VIEW_TABS.map(([id, label]) => jsx('button', {
              key: id,
              type: 'button',
              'data-kdocs-view': id,
              // A search answers the same question a view does, so it takes the
              // highlight: two tabs lit at once would misstate what is on screen.
              'data-kdocs-view-active': !searching && state.view === id ? 'true' : 'false',
              onClick: () => void openView(id),
              style: {
                fontSize: '11.5px',
                padding: '2px 8px',
                borderRadius: '999px',
                border: '0.5px solid var(--dsw-alias-border-l3)',
                background: !searching && state.view === id ? 'var(--dsw-alias-interactive-bg-hover)' : 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                opacity: !searching && state.view === id ? 1 : 0.75,
                font: 'inherit',
                whiteSpace: 'nowrap',
              },
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
              style: { ...{ position: 'fixed', zIndex: 50, minWidth: '170px', padding: '4px', borderRadius: '8px', border: '0.5px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-overlay)', boxShadow: '0 4px 16px rgba(0, 0, 0, 0.22)', display: 'flex', flexDirection: 'column', gap: '1px' }, left: `${String(menu.x)}px`, top: `${String(menu.y)}px` },
              children: [
                jsx('div', { key: 'head', style: { padding: '4px 9px 6px', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: menu.entry.name }),
                jsx('button', { key: 'quote', type: 'button', 'data-kdocs-menu-item': 'quote', disabled: !canQuote || menuBusy, onClick: () => void runMenuAction(menu.entry, menuActions.quote), style: { ...{ ...HEADER_ACTION_STYLE, border: 'none', textAlign: 'left', width: '100%', padding: '5px 9px', borderRadius: '6px' }, font: 'inherit', opacity: canQuote ? 1 : 0.5 }, children: t('menuQuote') }),
                jsx('button', { key: 'open', type: 'button', 'data-kdocs-menu-item': 'open', disabled: menuBusy, onClick: () => void runMenuAction(menu.entry, menuActions.openOnline), style: { ...{ ...HEADER_ACTION_STYLE, border: 'none', textAlign: 'left', width: '100%', padding: '5px 9px', borderRadius: '6px' }, font: 'inherit' }, children: t('menuOpen') }),
                jsx('button', { key: 'copy', type: 'button', 'data-kdocs-menu-item': 'copy', disabled: menuBusy, onClick: () => void runMenuAction(menu.entry, menuActions.copyLink), style: { ...{ ...HEADER_ACTION_STYLE, border: 'none', textAlign: 'left', width: '100%', padding: '5px 9px', borderRadius: '6px' }, font: 'inherit' }, children: t('menuCopyLink') }),
                jsx('button', { key: 'detail', type: 'button', 'data-kdocs-menu-item': 'detail', disabled: menuBusy, onClick: () => void runMenuAction(menu.entry, menuActions.detail), style: { ...{ ...HEADER_ACTION_STYLE, border: 'none', textAlign: 'left', width: '100%', padding: '5px 9px', borderRadius: '6px' }, font: 'inherit' }, children: t('menuDetail') }),
                jsx('button', { key: 'versions', type: 'button', 'data-kdocs-menu-item': 'versions', disabled: menuBusy, onClick: () => void runMenuAction(menu.entry, menuActions.versions), style: { ...{ ...HEADER_ACTION_STYLE, border: 'none', textAlign: 'left', width: '100%', padding: '5px 9px', borderRadius: '6px' }, font: 'inherit' }, children: t('menuVersions') }),
                jsx('button', { key: 'comments', type: 'button', 'data-kdocs-menu-item': 'comments', disabled: menuBusy, onClick: () => void runMenuAction(menu.entry, menuActions.comments), style: { ...{ ...HEADER_ACTION_STYLE, border: 'none', textAlign: 'left', width: '100%', padding: '5px 9px', borderRadius: '6px' }, font: 'inherit' }, children: t('menuComments') }),
                jsx('button', { key: 'rename', type: 'button', 'data-kdocs-menu-item': 'rename', disabled: menuBusy, onClick: () => menuActions.rename(menu.entry), style: { ...{ ...HEADER_ACTION_STYLE, border: 'none', textAlign: 'left', width: '100%', padding: '5px 9px', borderRadius: '6px' }, font: 'inherit' }, children: t('menuRename') }),
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
                jsx('div', { key: 'actions', style: { display: 'flex', gap: '6px' } },
                  jsx('button', { key: 'ok', type: 'button', 'data-kdocs-rename-commit': 'true', disabled: menuBusy, onClick: () => void commitRename(), style: { ...HEADER_ACTION_STYLE, textAlign: 'left', padding: '5px 9px', font: 'inherit', width: 'auto', border: '0.5px solid var(--dsw-alias-border-l3)' }, children: menuBusy ? t('renameBusy') : t('renameCommit') }),
                  jsx('button', { key: 'cancel', type: 'button', 'data-kdocs-rename-cancel': 'true', onClick: () => setRenameDraft(undefined), style: { ...HEADER_ACTION_STYLE, textAlign: 'left', padding: '5px 9px', font: 'inherit', width: 'auto', border: '0.5px solid var(--dsw-alias-border-l3)' }, children: t('renameCancel') }),
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
            style: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '0 6px 8px' },
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
     * @param {any} Component - the body component.
     * @returns {any} a component that renders either the body or its error.
     */
    function guarded(Component) {
      return function Guarded(props) {
        try {
          return Component(props);
        } catch (error) {
          const message = String(error && error.message ? error.message : error);
          return jsx('div', {
            'data-kdocs-error': 'true',
            style: { padding: '12px 10px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap' },
            children: `${Component.name || 'kdocs'} 渲染失败：${message}`,
          });
        }
      };
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
      // kind. The panel is a page with fixed copy; a preview is a document, and its
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
     * @param {any} ctx - the client root context.
     * @returns {Promise<void>} resolves once mounting has been handed to Cordis.
     */
    exports.apply = async function apply(ctx) {
      ctx.effect(async () => {
        const dispose = await ctx.remote.$mount(TYPERT_REMOTE);
        return () => dispose();
      }, 'kdocs: mount the kdocs Remote namespace');

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
    exports.toggleFolder = toggleFolder;
    exports.markLoading = markLoading;
    exports.folderKey = folderKey;
    exports.ROOT_LEVEL = ROOT_LEVEL;
    exports.KDOCS_KIND = KDOCS_KIND;
    exports.KDOCS_ID = KDOCS_ID;
    exports.kdocsDefinition = kdocsDefinition;
    exports.KDocsBody = KDocsBody;
    exports.kdocsPreviewDefinition = kdocsPreviewDefinition;
    exports.parseMarkdown = parseMarkdown;
    exports.inlineSpans = inlineSpans;
    exports.unwrapResult = unwrapResult;
    exports.guarded = guarded;
    exports.PREVIEW_KIND = PREVIEW_KIND;
    exports.PREVIEW_ID = PREVIEW_ID;
    exports.kdocsEmbedUrl = kdocsEmbedUrl;
    exports.createKDocsResourceProvider = createKDocsResourceProvider;

    return module.exports;
  },
});
