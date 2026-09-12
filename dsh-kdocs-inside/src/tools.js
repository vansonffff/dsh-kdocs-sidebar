/**
 * The Agent-facing tools: `kdocs_list` / `kdocs_search` / `kdocs_read` / `kdocs_stat`.
 *
 * Four tools, all **read-only**. They are the fourth consumer of the seam — the
 * others being the right-sidebar panel, the preview tab, and (through the
 * preview) the resource protocol:
 *
 * ```
 *   ui-sidebar-kdocs   kdocs-preview   (resource protocol)
 *            \              |              /
 *             \             |             /
 *              +------- ctx.kdocs -------+
 *                          |
 *                    these tools
 * ```
 *
 * **They never spawn the CLI.** Every call goes through `ctx.kdocs`, which is what
 * keeps the seam meaningful: swapping the Provider must not require touching a
 * tool. A tool that ran `kdocs-cli` itself would silently bypass the seam's error
 * taxonomy, pagination, and truncation.
 *
 * ## How failures reach the model
 *
 * A thrown error is what the tool runtime reports as a failed call, so these
 * throw. The message is built from {@link KDocsError}'s own vocabulary rather
 * than passing the raw error through: the model needs to know *what to do* about
 * a rate limit, and "429002" alone does not say "wait".
 *
 * @module kdocs/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools';

import { KDocsError } from './errors.js';
import { parseKDocsLocator } from './resource.js';

/** Where the seam is registered, as these tools address it. */
const SEAM = 'kdocs';

/**
 * Turn one seam failure into a message the model can act on.
 *
 * Retryable failures carry their wait, and every message carries the seam's
 * normalized code, so a model can distinguish "authenticate" from "wait" from
 * "wrong id" without parsing prose.
 *
 * @param {unknown} error - whatever the seam threw.
 * @param {string} operation - the tool that was running.
 * @returns {Error} the error to throw out of the tool.
 */
function toToolError(error, operation) {
  if (!KDocsError.is(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const parts = [`${error.message}`, `[code=${error.code}]`];
  if (typeof error.retryAfterMs === 'number') {
    parts.push(`retry after ~${String(Math.ceil(error.retryAfterMs / 1000))}s`);
  }
  if (error.code === 'not-authenticated') {
    parts.push('the user must sign in to 金山文档 in DSH Settings');
  }
  if (error.code === 'cli-not-installed') {
    parts.push('kdocs-cli is not installed on this machine');
  }
  return new Error(`${operation} failed: ${parts.join(' ')}`);
}

/**
 * One entry as one line of model-readable text.
 *
 * Identity, name, kind and freshness — the four things a model needs to decide
 * whether to read it. The address form is included because that is how the
 * preview tab and any later Case Workspace refer to the same document.
 *
 * @param {import('./types.js').KDocsEntry} entry - the entry.
 * @param {(ref: import('./types.js').KDocsFileRef) => string} addressOf - address builder.
 * @returns {string} one line.
 */
function entryLine(entry, addressOf) {
  const bits = [`- ${entry.name}`];
  bits.push(entry.kind === 'directory' ? '[folder]' : `[${entry.extension ?? 'file'}]`);
  if (entry.modifiedAt !== undefined) bits.push(`modified ${entry.modifiedAt.slice(0, 10)}`);
  if (entry.size !== undefined) bits.push(`${String(entry.size)} bytes`);
  bits.push(addressOf(entry.ref));
  return bits.join('  ');
}

/**
 * The `KDocsFileRef` shape, as both tools and model see it.
 *
 * Kept as a plain JSON schema rather than a zod one: `defineTool` compiles this
 * to what the model is offered, and a ref is two required strings.
 *
 * `required` is a marker, not a boolean: a field is made optional by omitting the
 * key entirely (writing `required: false` fails compilation). It is omitted here
 * because `address` can name the document instead.
 *
 * @type {any}
 */
const REF_PARAMETER = {
  type: 'object',
  additionalProperties: false,
  description: 'Document identity: { driveId, fileId }. Take both from kdocs_list or kdocs_search.',
  properties: {
    driveId: { type: 'string', required: true, description: 'Cloud drive id.' },
    fileId: { type: 'string', required: true, description: 'File id within that drive.' },
  },
};

/**
 * A document handle carried as one string.
 *
 * This is what makes a *quoted* document usable. The 📄 marker the panel writes
 * into the composer carries a `dsh-resource://` address, and the model can hand
 * that string straight back instead of splitting it into two fields — which is
 * exactly the step it would otherwise get wrong.
 *
 * @type {any}
 */
const ADDRESS_PARAMETER = {
  type: 'string',
  description: 'A document handle instead of `ref`: a dsh-resource://kdocs/file/<driveId>/<fileId> address '
    + '(what kdocs_list prints), or a 金山文档 share link.',
};

/**
 * Resolve one tool call's document handle.
 *
 * `address` wins when both are present: it is the handle the user's own action
 * produced, so it is the more recent statement of intent.
 *
 * @param {any} args - the tool arguments.
 * @param {string} tool - the tool name, for the error message.
 * @returns {import('./types.js').KDocsLocator} what the seam should be given.
 * @throws {KDocsError} with `'invalid-request'` when neither form is usable.
 */
function locatorOf(args, tool) {
  if (typeof args.address === 'string' && args.address.trim() !== '') {
    const parsed = parseKDocsLocator(args.address);
    if (parsed === undefined) {
      throw new KDocsError('invalid-request', {
        operation: tool,
        message: `无法识别的文档地址「${args.address.slice(0, 120)}」；`
          + '应为 dsh-resource://kdocs/file/<driveId>/<fileId> 或金山文档分享链接',
      });
    }
    return parsed.ref === undefined ? { url: parsed.url } : parsed.ref;
  }
  if (args.ref !== undefined && args.ref !== null) return args.ref;
  throw new KDocsError('invalid-request', {
    operation: tool,
    message: '缺少文档标识：请给出 ref（{ driveId, fileId }）或 address（文档地址/链接）之一',
  });
}

/**
 * Resolve one `kdocs_list` call's container.
 *
 * Narrower than {@link locatorOf} on purpose: the CLI lists by parent *id*, so a
 * share link cannot be a container. Saying that plainly beats passing a link
 * through and letting the backend answer with something generic.
 *
 * @param {any} args - the tool arguments.
 * @returns {import('./types.js').KDocsFileRef | undefined} the container, or undefined for the drive root.
 */
function parentOf(args) {
  if (typeof args.address === 'string' && args.address.trim() !== '') {
    const parsed = parseKDocsLocator(args.address);
    if (parsed === undefined || parsed.ref === undefined) {
      throw new KDocsError('invalid-request', {
        operation: 'kdocs_list',
        message: '列目录需要 dsh-resource://kdocs/file/<driveId>/<fileId> 形式的地址；'
          + '分享链接不能作为容器，请先 kdocs_stat 它拿到身份。',
      });
    }
    return parsed.ref;
  }
  if (args.parent !== undefined && args.parent !== null) return args.parent;
  return undefined;
}

/**
 * Register the KDocs tools.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - a context in which both `kdocs` and `tools` are available.
 * @returns {void}
 */
export function registerKDocsTools(ctx) {
  const seam = () => {
    const service = ctx.get(SEAM);
    if (service === undefined) {
      throw new KDocsError('unknown', {
        operation: 'tools',
        message: 'ctx.kdocs 尚未注册，工具无法工作',
      });
    }
    return service;
  };

  // Address building is the client's grammar; here it only labels results, so a
  // failure to build one must not fail the call.
  const addressOf = (ref) => `dsh-resource://kdocs/file/${ref.driveId}/${ref.fileId}`;

  ctx.tools.register(defineTool({
    name: 'kdocs_list',
    description:
      'List a folder in the user\'s personal 金山文档 (KDocs) drive, or the drive root when no folder is given. '
      + 'Returns one line per entry with its identity address. Use kdocs_read to read a document\'s text. '
      + 'Reading files is preferred over asking the user to paste content.',
    parameters: {
      parent: {
        type: 'object',
        additionalProperties: false,
        description: 'Folder to list: { driveId, fileId }. Omit to list the drive root.',
        properties: {
          driveId: { type: 'string', required: true, description: 'Cloud drive id.' },
          fileId: { type: 'string', required: true, description: 'Folder id.' },
        },
      },
      cursor: {
        type: 'string',
        description: 'Opaque cursor from a previous call, to fetch the next page.',
      },
      // A quoted *folder* arrives as one address string, exactly like a quoted
      // document. Without this the model has to split it into two fields by hand —
      // the step the address form exists to remove.
      address: ADDRESS_PARAMETER,
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: { type: 'array', required: true, items: { type: 'string' } },
          nextCursor: { type: 'string' },
          pageCount: { type: 'integer', required: true },
          total: { type: 'integer' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.entries.length === 0
          ? 'The folder is empty.'
          : `${String(value.total)} entr${value.total === 1 ? 'y' : 'ies'}:\n${value.entries.join('\n')}`
            + (value.nextCursor === undefined ? '' : `\n\nMore results: call kdocs_list again with cursor="${value.nextCursor}"`),
      }],
    },
    async execute(args, exec) {
      try {
        const page = await seam().list(parentOf(args), args.cursor, exec.signal);
        const entries = page.entries.map((entry) => entryLine(entry, addressOf));
        /** @type {any} */
        const value = { entries, total: page.entries.length };
        if (page.nextCursor !== undefined) value.nextCursor = page.nextCursor;
        return value;
      } catch (error) {
        throw toToolError(error, 'kdocs_list');
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'kdocs_search',
    description:
      'Search the user\'s 金山文档 (KDocs) drive by keyword. Searches file names and document contents. '
      + 'Use this to find a document the user refers to by name or topic, then kdocs_read it.',
    parameters: {
      query: { type: 'string', required: true, description: 'Search keyword.' },
      cursor: {
        type: 'string',
        description: 'Resume a search the previous call reported as having more results.',
      },
      // Narrowing, one optional field per measured `search-files` parameter.
      scope: {
        type: 'string',
        description: "Where to look: 'all' (default), 'file_name' for names only, or 'content' to "
          + 'match inside document bodies. Use content when the user remembers wording rather than a title.',
      },
      fileExts: {
        type: 'array',
        items: { type: 'string' },
        description: "Keep only these extensions, e.g. ['docx','pdf'].",
      },
      modifiedAfterDays: {
        type: 'integer',
        description: 'Keep only documents modified within this many days.',
      },
      withTotal: {
        type: 'boolean',
        description: 'Also report how many matches exist in total, not just this page.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: { type: 'array', required: true, items: { type: 'string' } },
          nextCursor: { type: 'string' },
          total: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: (value.entries.length === 0
          ? 'No documents matched.'
          : `${String(value.entries.length)} match${value.entries.length === 1 ? '' : 'es'}`
            + (value.total === undefined ? '' : ` out of ${String(value.total)} in total`)
            + `:\n${value.entries.join('\n')}`)
          + (value.nextCursor === undefined
            ? ''
            : `\n\nMore results: call kdocs_search again with the same query and cursor="${value.nextCursor}"`),
      }],
    },
    async execute(args, exec) {
      try {
        /** @type {import('./types.js').KDocsSearchOptions} */
        const options = {};
        if (args.scope !== undefined) options.type = args.scope;
        if (Array.isArray(args.fileExts) && args.fileExts.length > 0) options.fileExts = args.fileExts;
        if (typeof args.modifiedAfterDays === 'number') {
          options.timeType = 'mtime';
          options.startTime = Math.floor(Date.now() / 1000) - Math.round(args.modifiedAfterDays * 86400);
        }
        if (args.withTotal === true) options.withTotal = true;
        const result = await seam().search(args.query, args.cursor, options, exec.signal);
        const entries = result.entries.map((entry) => entryLine(entry, addressOf));
        /** @type {any} */
        // `pageCount` is how many lines this reply carries; `total` is how many
        // matches exist in the whole drive and is absent unless the caller asked
        // for it. They used to be swapped — the page size was reported as the total
        // — so a model was told "1 match out of 1 in total" for a query the backend
        // had answered with 2263.
        const value = { entries, pageCount: entries.length };
        if (result.nextCursor !== undefined) value.nextCursor = result.nextCursor;
        if (typeof result.total === 'number') value.total = result.total;
        return value;
      } catch (error) {
        throw toToolError(error, 'kdocs_search');
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'kdocs_stat',
    description:
      'Read one 金山文档 (KDocs) document\'s metadata without its body: name, type, size and last modification. '
      + 'Use it to confirm identity or check whether a document changed since it was last read. '
      + 'Address the document by `ref` or by `address` (a dsh-resource:// address or a 金山文档 link).',
    parameters: { ref: REF_PARAMETER, address: ADDRESS_PARAMETER },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          extension: { type: 'string' },
          modifiedAt: { type: 'string' },
          size: { type: 'integer' },
          address: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.name}\n`
          + `type: ${value.kind}${value.extension === undefined ? '' : ` (.${value.extension})`}\n`
          + (value.modifiedAt === undefined ? '' : `modified: ${value.modifiedAt}\n`)
          + (value.size === undefined ? '' : `size: ${String(value.size)} bytes\n`)
          + `address: ${value.address}`,
      }],
    },
    async execute(args, exec) {
      try {
        const entry = await seam().stat(locatorOf(args, 'kdocs_stat'), exec.signal);
        /** @type {any} */
        const value = { name: entry.name, kind: entry.kind, address: addressOf(entry.ref) };
        if (entry.extension !== undefined) value.extension = entry.extension;
        if (entry.modifiedAt !== undefined) value.modifiedAt = entry.modifiedAt;
        if (entry.size !== undefined) value.size = entry.size;
        return value;
      } catch (error) {
        throw toToolError(error, 'kdocs_stat');
      }
    },
  }));

  ctx.tools.register(defineTool({
    name: 'kdocs_read',
    description:
      'Read a 金山文档 (KDocs) document\'s text. Word, PDF and text documents return Markdown; '
      + 'presentations return slide-structured Markdown; spreadsheets return their tables. '
      + 'This is the tool for reviewing a contract or report the user keeps in 金山文档. '
      + 'When the user quotes a document into the conversation, pass that marker\'s '
      + 'dsh-resource:// address as `address`.',
    parameters: {
      ref: REF_PARAMETER,
      address: ADDRESS_PARAMETER,
      taskId: {
        type: 'string',
        description: 'Resume an extraction the previous call reported as still running.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', required: true },
          format: { type: 'string', required: true },
          content: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
          taskId: { type: 'string' },
          address: { type: 'string', required: true },
        },
      },
      render: (args, value) => [{
        type: 'text',
        text: `# ${value.name}\n`
          + `(source: 金山文档 · format: ${value.format} · ${value.address})\n\n`
          + value.content
          + (value.truncated ? '\n\n[body truncated by the kdocs seam; read a narrower range or ask for a specific section]' : '')
          + (value.taskId === undefined ? '' : `\n\n[extraction still running; call kdocs_read again with taskId="${value.taskId}"]`),
      }],
    },
    async execute(args, exec) {
      try {
        /** @type {any} */
        const options = {};
        if (args.taskId !== undefined) options.taskId = args.taskId;
        const content = await seam().read(locatorOf(args, 'kdocs_read'), options, exec.signal);
        /** @type {any} */
        const value = {
          name: content.name,
          format: content.format,
          content: content.content,
          truncated: content.truncated === true,
          address: addressOf(content.ref),
        };
        if (content.taskId !== undefined) value.taskId = content.taskId;
        return value;
      } catch (error) {
        // A folder has no body, and the CLI's answer ("Cannot determine file type;
        // check the extension") sends the model looking for a file-name problem it
        // does not have. The remedy is a different tool, so say which.
        if (KDocsError.is(error) && /Cannot determine file type/i.test(String(error.message ?? ''))) {
          throw toToolError(new KDocsError('unsupported', {
            operation: 'kdocs_read',
            message: '这个对象没有可读取的正文 —— 如果它是文件夹，请改用 kdocs_list（把同一个 address 传给它即可列出内容）。',
          }), 'kdocs_read');
        }
        throw toToolError(error, 'kdocs_read');
      }
    },
  }));
}
