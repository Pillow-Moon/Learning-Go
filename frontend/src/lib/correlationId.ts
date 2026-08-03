/**
 * Cross-stack correlation id for analysis requests.
 *
 * Generated once per analysis call at the engine layer and shared between the
 * frontend console and backend logs, so the same analysis stays traceable
 * across engine sources (browser <-> local) and across the HTTP boundary.
 *
 * Format: `anl-<epochMs>-<rand8>`, e.g. `anl-1722729600000-3f2a9b1c`.
 * Uses crypto.getRandomValues (32 bits) to keep collision probability
 * negligible even for many calls within the same millisecond.
 *
 * Author: Qoder
 */

/** Create a new correlation id. */
export function newCorrelationId(): string {
  const rand = crypto
    .getRandomValues(new Uint32Array(1))[0]
    .toString(16)
    .padStart(8, '0')
  return `anl-${Date.now()}-${rand}`
}
