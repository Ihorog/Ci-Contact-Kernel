'use strict';

/**
 * sourceAdapter — source-independent intake contract for Cigrafin.
 *
 * A SourceItem represents a single mailbox entry from any source.
 * Adapters must produce objects conforming to this shape; downstream
 * pipeline stages rely solely on this interface.
 *
 * Required fields:
 *   source_repo    {string}  canonical source repository URL
 *   source_ref     {string}  branch/tag/ref name
 *   path           {string}  relative path within the source
 *   blob_sha       {string|null}  git blob SHA if available
 *   media_type     {string|null}  MIME type if known by the source
 *   size_bytes     {number|null}  byte length if known
 *   source_type    {string}  'github' | 'local' | 'upload' | 'unknown'
 *   fetch          {()=>Promise<Buffer|null>}  lazy fetcher; null if not supported
 *   deleted        {boolean} true when source entry was removed/renamed
 *   raw_metadata   {object}  arbitrary source-side metadata, preserved verbatim
 */

const INGEST_STATUS = Object.freeze({
  RECEIVED:        'RECEIVED',
  HASHED:          'HASHED',
  DETECTED:        'DETECTED',
  PARSED:          'PARSED',
  CLAIMS_EXTRACTED:'CLAIMS_EXTRACTED',
  CLASSIFIED:      'CLASSIFIED',
  RESOLVED:        'RESOLVED',
  ROUTED:          'ROUTED',
  QUARANTINED:     'QUARANTINED',
  FAILED:          'FAILED',
  DELETED:         'DELETED',
});

const SOURCE_TYPE = Object.freeze({
  GITHUB:  'github',
  LOCAL:   'local',
  UPLOAD:  'upload',
  UNKNOWN: 'unknown',
});

/**
 * Validate that a candidate object satisfies the SourceItem contract.
 * Throws TypeError with a descriptive message on violation.
 *
 * @param {object} item
 * @returns {object} the same item, for fluent use
 */
function validateSourceItem(item) {
  if (!item || typeof item !== 'object') throw new TypeError('SourceItem must be an object');
  if (typeof item.source_repo !== 'string' || !item.source_repo)
    throw new TypeError('SourceItem.source_repo must be a non-empty string');
  if (typeof item.source_ref !== 'string' || !item.source_ref)
    throw new TypeError('SourceItem.source_ref must be a non-empty string');
  if (typeof item.path !== 'string' || !item.path)
    throw new TypeError('SourceItem.path must be a non-empty string');
  if (typeof item.fetch !== 'function' && item.fetch !== null)
    throw new TypeError('SourceItem.fetch must be a function or null');
  if (typeof item.deleted !== 'boolean')
    throw new TypeError('SourceItem.deleted must be a boolean');
  return item;
}

/**
 * Build a minimal SourceItem from a plain object, filling optional fields
 * with safe defaults.
 *
 * @param {object} fields
 * @returns {object}
 */
function createSourceItem(fields = {}) {
  return validateSourceItem({
    source_repo:   fields.source_repo,
    source_ref:    fields.source_ref    ?? 'main',
    path:          fields.path,
    blob_sha:      fields.blob_sha      ?? null,
    media_type:    fields.media_type    ?? null,
    size_bytes:    fields.size_bytes    ?? null,
    source_type:   fields.source_type   ?? SOURCE_TYPE.UNKNOWN,
    fetch:         fields.fetch         ?? null,
    deleted:       fields.deleted       ?? false,
    raw_metadata:  fields.raw_metadata  ?? {},
  });
}

module.exports = { createSourceItem, validateSourceItem, INGEST_STATUS, SOURCE_TYPE };
