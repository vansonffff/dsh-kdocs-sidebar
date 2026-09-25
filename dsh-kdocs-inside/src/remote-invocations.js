/**
 * The `kdocs` Remote surface, described once.
 *
 * `typert.host.js` and `typert.remote-client.js` are both derived from this
 * table. They must agree field-for-field — a mismatch is a runtime signature
 * error, not a compile error, because nothing regenerates them on this machine.
 * Deriving both from one description removes that class of drift entirely.
 *
 * Every method resolves to a **business value**, which the framework wraps in its
 * own `{ ok, value } | { ok, error }` envelope — the Client API and the Gateway
 * each apply that shape, so a descriptor must not add a second one.
 *
 * @module kdocs/remote-invocations
 */

/**
 * The object shape of a result payload.
 *
 * @typedef {{ fields: import('./remote-schemas.js').KDocsField[] }} KDocsShape
 */

/**
 * One business parameter of a Remote method.
 *
 * @typedef {object} KDocsInvocationParameter
 * @property {string} name - wire field name, matching the receiver's parameter name.
 * @property {import('./remote-schemas.js').KDocsFieldKind} [kind] - validation kind; defaults to `freeObject`.
 * @property {boolean} [optional] - whether the caller may omit it.
 */

/**
 * One Remote method.
 *
 * `parameters` are the business arguments in declaration order. The trailing
 * `signal` of a cancellable method is covered by
 * {@link KDocsInvocation.cancellable} rather than listed here, because the
 * Gateway appends the carrier signal and keeps it out of the argument-object
 * contract.
 *
 * @typedef {object} KDocsInvocation
 * @property {string} method - the receiver method name, validated against the source by the Gateway.
 * @property {KDocsInvocationParameter[]} parameters - business parameters, in order.
 * @property {import('./remote-schemas.js').KDocsFieldKind} valueKind - the kind carried in `value` on success.
 * @property {boolean} cancellable - whether a trailing `signal` parameter exists.
 */

/**
 * Every Remote method this package exposes.
 *
 * Each entry names the wire method publicly and the receiver method that
 * implements it. The alias is required, not cosmetic: the strict dispatcher
 * looks up a *method-named* member first, so a remote method sharing a name with
 * a seam method would return the seam's bare value instead of an envelope.
 *
 * @type {KDocsInvocation[]}
 */
export const KDOCS_INVOCATIONS = [
  { method: 'status', implementation: 'remoteStatus', parameters: [], valueKind: 'status', cancellable: true },
  {
    method: 'list',
    implementation: 'remoteList',
    parameters: [
      { name: 'parent', kind: 'fileRef', optional: true },
      { name: 'cursor', kind: 'string', optional: true },
    ],
    valueKind: 'page',
    cancellable: true,
  },
  {
    method: 'listVersions',
    implementation: 'remoteListVersions',
    parameters: [{ name: 'ref', kind: 'fileRef' }],
    valueKind: 'freeObject',
    cancellable: true,
  },
  {
    method: 'listComments',
    implementation: 'remoteListComments',
    parameters: [{ name: 'ref', kind: 'fileRef' }],
    valueKind: 'freeObject',
    cancellable: true,
  },
  {
    method: 'rename',
    implementation: 'remoteRename',
    parameters: [
      { name: 'ref', kind: 'fileRef' },
      { name: 'newName', kind: 'string' },
    ],
    valueKind: 'entry',
    cancellable: true,
  },
  {
    method: 'listView',
    implementation: 'remoteListView',
    parameters: [
      { name: 'view', kind: 'string' },
      { name: 'cursor', kind: 'string', optional: true },
    ],
    valueKind: 'page',
    cancellable: true,
  },
  {
    method: 'search',
    implementation: 'remoteSearch',
    parameters: [
      { name: 'query', kind: 'string' },
      { name: 'cursor', kind: 'string', optional: true },
      { name: 'options', kind: 'freeObject', optional: true },
    ],
    valueKind: 'search',
    cancellable: true,
  },
  {
    method: 'stat',
    implementation: 'remoteStat',
    parameters: [{ name: 'ref', kind: 'fileRef' }],
    valueKind: 'entry',
    cancellable: true,
  },
  {
    method: 'read',
    implementation: 'remoteRead',
    parameters: [
      { name: 'ref', kind: 'fileRef' },
      { name: 'options', kind: 'freeObject', optional: true },
    ],
    valueKind: 'content',
    cancellable: true,
  },
  {
    method: 'getLink',
    implementation: 'remoteGetLink',
    parameters: [{ name: 'ref', kind: 'fileRef' }],
    valueKind: 'string',
    cancellable: true,
  },
  {
    method: 'exportPdf',
    implementation: 'remoteExportPdf',
    parameters: [
      { name: 'ref', kind: 'fileRef' },
      { name: 'options', kind: 'freeObject', optional: true },
    ],
    valueKind: 'freeObject',
    cancellable: true,
  },
];

/** The npm package name carried in both manifests. */
export const KDOCS_PACKAGE = 'dsh-kdocs-inside';

/**
 * The wire namespace, i.e. `ctx.remote.kdocs`.
 *
 * Declared here so this module stays the root of the dependency graph for both
 * generated artifacts, which keeps their imports free of cycles.
 */
export const KDOCS_NAMESPACE = 'kdocs';

/**
 * Build the generator-shaped descriptors for both Remote faces.
 *
 * The two artifacts differ only in their schemas — real zod on the Host, a
 * passthrough in the browser — so everything else is built here once. Without
 * this, a field renamed in one artifact would surface as a runtime signature
 * error rather than as a review comment.
 *
 * @param {object} options - build options.
 * @param {(kind: import('./remote-schemas.js').KDocsFieldKind) => unknown} options.parameterSchema - builds one parameter's schema.
 * @param {(kind: import('./remote-schemas.js').KDocsFieldKind) => unknown} options.valueSchema - builds the business-value schema for one method.
 * @returns {any[]} one descriptor per Remote method.
 */
export function buildRemoteDescriptors({ parameterSchema, valueSchema }) {
  const namespace = KDOCS_NAMESPACE;
  return KDOCS_INVOCATIONS.map((invocation) => ({
    id: `${KDOCS_PACKAGE}#${namespace}/${invocation.method}`,
    service: namespace,
    namespace,
    method: invocation.method,
    // The alias the strict dispatcher invokes when it differs from the public
    // name; see the note on KDOCS_INVOCATIONS.
    ...(invocation.implementation === undefined ? {} : { implementation: invocation.implementation }),
    invocation: { kind: 'direct' },
    parameters: invocation.parameters.map((parameter) => ({
      name: parameter.name,
      wire: parameter.name,
      source: 'json',
      acceptsUndefined: parameter.optional === true,
      codec: {
        mode: 'strict',
        typeSymbol: `${KDOCS_PACKAGE}#${namespace}/${invocation.method}:${parameter.name}`,
        create: () => parameterSchema(parameter.kind ?? 'freeObject'),
      },
    })),
    ...(invocation.cancellable ? { cancellation: { parameter: 'signal' } } : {}),
    result: {
      mode: 'strict',
      typeSymbol: `${KDOCS_PACKAGE}/${namespace}#${invocation.method}:result`,
      create: () => valueSchema(invocation.valueKind),
    },
  }));
}
