/**
 * Host face of the `kdocs` Typert Remote.
 *
 * `@deepseek-ai/dsh-typert-loader` discovers this module because the package
 * declares `"./typert"` in its `exports`: when the plugin's loader entry mounts,
 * the loader imports this module and calls `ctx.typert.register(TYPERT)`, then
 * withdraws the registration on unmount. Nothing in DSH core needs to know this
 * package exists.
 *
 * The file is *hand-written*, not emitted by
 * `@deepseek-ai/dsh-typert-generator` — that generator is not part of the
 * installed DSH distribution (it is a source-tree build step). It therefore
 * follows the generator's output shape exactly (see
 * `dsh-host-plugin-inventory/lib/typert.host.js` in the DSH install for the
 * minimal reference) while deriving every descriptor from
 * {@link module:kdocs/remote-invocations}, so the client artifact cannot drift.
 *
 * Schemas here are **real zod** schemas: this face runs on the Host, where zod
 * is already present, and the Gateway parses both parameters and results
 * through them.
 *
 * @module kdocs/typert.host
 */

import { z } from 'zod';

import {
  KDOCS_INVOCATIONS,
  KDOCS_NAMESPACE,
  KDOCS_PACKAGE,
  buildRemoteDescriptors,
} from './src/remote-invocations.js';
import { fieldSchema } from './src/remote-schemas.js';

/**
 * The Typert host manifest registered into `ctx.typert`.
 *
 * `model.services` stays empty: that array declares Cordis-service projections,
 * and a facade that exposes methods has none — an honest empty rather than a
 * fabricated surface.
 *
 * @type {any}
 */
export const TYPERT = {
  package: KDOCS_PACKAGE,
  face: 'host',
  schemas: [],
  invocations: buildRemoteDescriptors({
    parameterSchema: (kind) => fieldSchema({ name: 'parameter', kind }, z),
    // The business value only: the Gateway adds the `{ ok, value }` envelope on
    // the wire, and validating a second one here rejected every result.
    valueSchema: (kind) => fieldSchema({ name: 'value', kind }, z),
  }),
  model: {
    services: [],
    events: [],
    objects: [],
  },
};

export { KDOCS_INVOCATIONS, KDOCS_NAMESPACE };
