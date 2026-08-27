'use strict';

/**
 * Ci Graph — opaque Ci-ID generation and validation.
 *
 * Hard invariants (from spec):
 *  1. Every unique managed real/digital unit has immutable opaque ci_id.
 *  2. Mutable meaning must NEVER be encoded into ci_id.
 *
 * IDs use the format:  ci_<16-hex-chars>
 * The hex portion is derived from crypto.randomBytes — no semantic content.
 */

const { randomBytes } = require('crypto');

const CI_ID_PATTERN = /^ci_[0-9a-f]{16}$/;

/**
 * Generate a new opaque Ci-ID.
 * @returns {string}  e.g. "ci_3f7a2b1c4d5e6f7a"
 */
function generateCiId() {
  return 'ci_' + randomBytes(8).toString('hex');
}

/**
 * Validate that a value is a well-formed Ci-ID.
 * @param {*} value
 * @returns {boolean}
 */
function isValidCiId(value) {
  return typeof value === 'string' && CI_ID_PATTERN.test(value);
}

/**
 * Assert that a value is a valid Ci-ID, throwing if not.
 * @param {*} value
 * @returns {string}
 */
function assertCiId(value) {
  if (!isValidCiId(value)) {
    throw new TypeError(`Invalid ci_id: ${JSON.stringify(value)}`);
  }
  return value;
}

module.exports = { generateCiId, isValidCiId, assertCiId, CI_ID_PATTERN };
