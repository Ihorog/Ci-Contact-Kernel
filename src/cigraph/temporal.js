'use strict';

/**
 * Ci Graph — temporal layer handling.
 *
 * Hard invariant: TARGET/PREDICTED must never overwrite ACTUAL for the same entity.
 * Historical truth is append-only; corrections supersede prior claims.
 */

const { TEMPORAL_LAYER } = require('./registry');

const TEMPORAL_PRECEDENCE = Object.freeze({
  [TEMPORAL_LAYER.ACTUAL]: 4,
  [TEMPORAL_LAYER.HIST]: 3,
  [TEMPORAL_LAYER.PREDICTED]: 2,
  [TEMPORAL_LAYER.TARGET]: 1,
  [TEMPORAL_LAYER.UNKNOWN_TIME]: 0,
});

/**
 * Check whether a proposed temporal_layer may overwrite an existing one.
 *
 * @param {string} existingLayer
 * @param {string} proposedLayer
 * @returns {{ allowed: boolean, reason?: string }}
 */
function checkTemporalOverwrite(existingLayer, proposedLayer) {
  const existingPriority = TEMPORAL_PRECEDENCE[existingLayer] ?? -1;
  const proposedPriority = TEMPORAL_PRECEDENCE[proposedLayer] ?? -1;

  if (
    existingLayer === TEMPORAL_LAYER.ACTUAL &&
    (proposedLayer === TEMPORAL_LAYER.TARGET || proposedLayer === TEMPORAL_LAYER.PREDICTED)
  ) {
    return {
      allowed: false,
      reason: `${proposedLayer} must not overwrite ACTUAL; use append/supersede instead`,
    };
  }

  if (proposedPriority < existingPriority) {
    return {
      allowed: false,
      reason: `proposed layer ${proposedLayer} (priority ${proposedPriority}) ` +
              `cannot overwrite ${existingLayer} (priority ${existingPriority})`,
    };
  }

  return { allowed: true };
}

/**
 * Resolve the canonical temporal layer from an input value.
 * Returns UNKNOWN_TIME when the value is absent or unrecognised.
 *
 * @param {*} value
 * @returns {string}
 */
function resolveTemporalLayer(value) {
  const valid = new Set(Object.values(TEMPORAL_LAYER));
  if (typeof value === 'string' && valid.has(value.toUpperCase())) {
    return value.toUpperCase();
  }
  return TEMPORAL_LAYER.UNKNOWN_TIME;
}

/**
 * Extract and validate optional temporal interval fields from an input object.
 * @param {object} input
 * @returns {object}
 */
function extractTemporalFields(input = {}) {
  return {
    valid_from: input.valid_from || null,
    valid_to: input.valid_to || null,
    observed_at: input.observed_at || null,
    recorded_at: input.recorded_at || null,
    supersedes_ci_id: input.supersedes_ci_id || null,
  };
}

module.exports = {
  checkTemporalOverwrite,
  resolveTemporalLayer,
  extractTemporalFields,
  TEMPORAL_PRECEDENCE,
};
