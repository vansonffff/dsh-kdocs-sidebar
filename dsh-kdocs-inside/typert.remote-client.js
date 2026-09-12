/**
 * Client face of the `kdocs` Typert Remote.
 *
 * This is the paired artifact of {@link module:kdocs/typert.host}: a Client
 * assembly mounts it with `ctx.remote.$mount(TYPERT_REMOTE)`, which is what makes
 * `ctx.remote.kdocs` exist. DSH's own Client assembly mounts its built-in
 * namespaces from a fixed import list inside `@deepseek-ai/dsh-api-remotes`; a
 * profile plugin cannot be appended to that compiled list, so **this package
 * mounts its own contribution** from its client bundle (`client.js`). Same
 * mechanism, different owner.
 *
 * Deliberately dependency-free: the schemas are passthrough, because pulling zod
 * into a hand-written browser bundle would require a bundler to inline it. No
 * safety is lost — the Host validates every parameter and produces every result
 * through its own real zod schemas.
 *
 * The descriptor table is built by
 * {@link module:kdocs/remote-invocations buildRemoteDescriptors} — the same
 * function the Host artifact uses — so the two faces cannot disagree.
 *
 * @module kdocs/typert.remote-client
 */

import {
  KDOCS_PACKAGE,
  buildRemoteDescriptors,
} from './src/remote-invocations.js';
import { passthroughSchema } from './src/remote-schemas.js';

/**
 * The contribution a Client assembly mounts.
 *
 * The Gateway requires every codec to declare `mode: 'strict'` and to expose
 * `schema.parse`; a passthrough schema satisfies both without importing zod.
 *
 * @type {any}
 */
export const TYPERT_REMOTE = {
  package: KDOCS_PACKAGE,
  descriptors: buildRemoteDescriptors({
    parameterSchema: () => passthroughSchema(),
    valueSchema: () => passthroughSchema(),
  }),
};

export default TYPERT_REMOTE;
