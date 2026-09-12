/**
 * The remote face's result schemas and the shape a business failure takes.
 *
 * ## The wire cannot carry a business error (verified, not assumed)
 *
 * The Host seam throws `KDocsError` with a full taxonomy, but the Typert wire
 * **cannot** carry it: its error vocabulary is a closed set — `gateway/bad-request`,
 * `gateway/cancelled`, `gateway/internal` — so a thrown business error reaches the
 * Browser as `gateway/internal` with only a message string.
 *
 * The 0.1 implementation therefore does the simple thing: a remote method returns
 * the **business value** on success and lets `KDocsError` propagate on failure.
 * The Browser unpacks the framework's own `{ ok, value } | { ok, error }` envelope
 * and, on the failure arm, has only `message` to work with.
 *
 * **This is a real limitation, and it is why the panel currently recognizes a
 * credential problem by matching the text `未登录`.** It is recorded here rather
 * than papered over: an earlier revision of this comment described a design in
 * which `code`/`retryable`/`retryAfterMs` survived the wire intact, which the code
 * never did. Documentation that describes an unbuilt design is worse than a
 * documented gap, because it makes the gap invisible to review.
 *
 * The fix — returning failure *as a value* so the seam's vocabulary survives the
 * wire — is scheduled for 0.2 (see `docs/PLAN-0.1-FIX-AND-0.2.md`, decision D1).
 * It is deliberately not bundled into the 0.1 repair batch: it changes every
 * remote method, both hand-written Typert artifacts, and the Browser's unpacking
 * path at once.
 *
 * ## Why the shapes live here
 *
 * `typert.host.js` and `typert.remote-client.js` must agree field-for-field;
 * a drift between them is a runtime signature error, not a type error (nothing
 * generates these artifacts on this machine). Both import this module so there
 * is exactly one description of the surface.
 *
 * The two artifacts still differ in *how* they validate: the Host has `zod`
 * available and uses it, while the Browser bundle must not depend on a bundler
 * inlining zod, so it uses {@link passthroughSchema}. That difference is
 * confined to {@link fieldSchema}.
 *
 * @module kdocs/remote-schemas
 */

/**
 * A field's kind, which decides both its zod schema and its client-side
 * passthrough.
 *
 * The composite kinds (`fileRef`, `entry`, `entryArray`, `page`, `search`,
 * `content`, `status`, `loginEvent`, `failure`, `freeObject`) let the Host
 * validate a whole nested result rather than only its top level.
 *
 * @typedef {'string' | 'number' | 'boolean' | 'stringArray' | 'freeObject'
 *   | 'fileRef' | 'entry' | 'entryArray' | 'page' | 'search' | 'content'
 *   | 'status' | 'loginEvent' | 'failure'} KDocsFieldKind
 */

/**
 * One named field of a wire object.
 *
 * @typedef {object} KDocsField
 * @property {string} name - field name, as it appears on the wire.
 * @property {KDocsFieldKind} kind - how to validate it.
 * @property {boolean} [optional] - whether the field may be absent.
 */

/**
 * The record shape of `KDocsFileRef`.
 *
 * @type {KDocsField[]}
 */
export const FILE_REF_FIELDS = [
  { name: 'driveId', kind: 'string' },
  { name: 'fileId', kind: 'string' },
];

/**
 * The record shape of one `KDocsEntry`.
 *
 * @type {KDocsField[]}
 */
export const ENTRY_FIELDS = [
  { name: 'ref', kind: 'fileRef', optional: false },
  { name: 'name', kind: 'string' },
  { name: 'kind', kind: 'string' },
  { name: 'extension', kind: 'string', optional: true },
  { name: 'modifiedAt', kind: 'string', optional: true },
  { name: 'size', kind: 'number', optional: true },
];

/**
 * The record shape of `KDocsContent`.
 *
 * @type {KDocsField[]}
 */
export const CONTENT_FIELDS = [
  { name: 'ref', kind: 'fileRef', optional: false },
  { name: 'name', kind: 'string' },
  { name: 'format', kind: 'string' },
  { name: 'content', kind: 'string' },
  { name: 'truncated', kind: 'boolean' },
  { name: 'taskId', kind: 'string', optional: true },
];

/**
 * The record shape of one `KDocsLoginEvent`.
 *
 * @type {KDocsField[]}
 */
export const LOGIN_EVENT_FIELDS = [
  { name: 'kind', kind: 'string' },
  { name: 'url', kind: 'string', optional: true },
  { name: 'reason', kind: 'string', optional: true },
];

/**
 * The record shape of `KDocsStatus`.
 *
 * @type {KDocsField[]}
 */
export const STATUS_FIELDS = [
  { name: 'authenticated', kind: 'boolean' },
  { name: 'cliAvailable', kind: 'boolean' },
  { name: 'cliPath', kind: 'string', optional: true },
  { name: 'cliVersion', kind: 'string', optional: true },
  { name: 'source', kind: 'string' },
  { name: 'keychainAvailable', kind: 'boolean', optional: true },
  { name: 'keychainBackend', kind: 'string', optional: true },
  { name: 'checkedAt', kind: 'string', optional: true },
  { name: 'reason', kind: 'string', optional: true },
];

/**
 * The record shape of the failure carried inside an envelope.
 *
 * `code` is the seam's own vocabulary, which is why it survives as a string
 * rather than being flattened into a message.
 *
 * @type {KDocsField[]}
 */
export const FAILURE_FIELDS = [
  { name: 'code', kind: 'string' },
  { name: 'message', kind: 'string' },
  { name: 'retryable', kind: 'boolean' },
  { name: 'retryAfterMs', kind: 'number', optional: true },
  { name: 'upstreamCode', kind: 'number', optional: true },
];

/**
 * The application-level code the wire uses for a carried business failure.
 *
 * Named so a consumer can distinguish "the Host said no" from a carrier fault.
 */
export const KDOCS_REMOTE_FAILURE_CODE = 'kdocs/failure';

/**
 * Convert one {@link KDocsField} into a zod schema.
 *
 * Only the Host artifact calls this; the Browser artifact uses
 * {@link passthroughSchema} for the same field. Composite kinds recurse into
 * the shape tables above, so a nested entry or a whole page is genuinely
 * validated rather than waved through.
 *
 * @param {KDocsField} field - the field to build a schema for.
 * @param {any} z - the zod module (injected so this module stays import-free).
 * @returns {any} a zod schema for the field.
 */
export function fieldSchema(field, z) {
  /** @type {any} */
  let schema;
  switch (field.kind) {
    case 'string':
      schema = z.string();
      break;
    case 'number':
      schema = z.number();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    case 'stringArray':
      schema = z.array(z.string());
      break;
    case 'fileRef':
      schema = objectSchema(FILE_REF_FIELDS, z);
      break;
    case 'entry':
      schema = objectSchema(ENTRY_FIELDS, z);
      break;
    case 'entryArray':
      schema = z.array(objectSchema(ENTRY_FIELDS, z));
      break;
    case 'content':
      schema = objectSchema(CONTENT_FIELDS, z);
      break;
    case 'status':
      schema = objectSchema(STATUS_FIELDS, z);
      break;
    case 'loginEvent':
      schema = objectSchema(LOGIN_EVENT_FIELDS, z);
      break;
    case 'failure':
      schema = objectSchema(FAILURE_FIELDS, z);
      break;
    case 'page':
      schema = z.object({
        entries: z.array(objectSchema(ENTRY_FIELDS, z)).readonly(),
        nextCursor: z.string().readonly().optional(),
        parent: objectSchema(FILE_REF_FIELDS, z).readonly().optional(),
      });
      break;
    case 'search':
      schema = z.object({
        entries: z.array(objectSchema(ENTRY_FIELDS, z)).readonly(),
        nextCursor: z.string().readonly().optional(),
        // Present only when the call asked for a count. Omitting it here would
        // strip the field the panel's "100 / 2263" line depends on the moment a
        // strict client schema or an output decode is switched on.
        total: z.number().optional(),
      });
      break;
    case 'freeObject':
      schema = z.record(z.string(), z.unknown());
      break;
    default:
      schema = z.unknown();
      break;
  }
  schema = schema.readonly();
  return field.optional === true ? schema.optional() : schema;
}

/**
 * Build a zod object schema from a field table.
 *
 * @param {KDocsField[]} fields - the object's fields.
 * @param {any} z - the zod module.
 * @returns {any} a zod object schema.
 */
export function objectSchema(fields, z) {
  /** @type {Record<string, any>} */
  const shape = {};
  for (const field of fields) shape[field.name] = fieldSchema(field, z);
  return z.object(shape).readonly();
}

/**
 * Build a client-side schema that validates nothing.
 *
 * The Browser contribution must supply a `codec.schema.parse`, but pulling zod
 * into a hand-written client bundle would require a bundler to inline it. The
 * Host re-validates every parameter and produces every result, so a permissive
 * client schema costs no safety.
 *
 * @returns {{ parse: (value: unknown) => unknown }} a passthrough schema.
 */
export function passthroughSchema() {
  return {
    parse(value) {
      return value;
    },
  };
}
