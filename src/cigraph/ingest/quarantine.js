'use strict';

/**
 * quarantine — persists unresolved/unsupported/failed ingest items.
 *
 * Quarantined records are retained permanently with a deterministic reason
 * code.  They can be manually inspected and reprocessed when a suitable
 * parser/classifier becomes available.
 */

const crypto = require('crypto');

const QUARANTINE_REASON = Object.freeze({
  PENDING_PARSER:      'PENDING_PARSER',
  PARSE_ERROR:         'PARSE_ERROR',
  CLASSIFICATION_UNKNOWN: 'CLASSIFICATION_UNKNOWN',
  CONFLICT_DETECTED:   'CONFLICT_DETECTED',
  FETCH_FAILED:        'FETCH_FAILED',
  SIZE_EXCEEDED:       'SIZE_EXCEEDED',
  BINARY_UNSUPPORTED:  'BINARY_UNSUPPORTED',
  UNRESOLVED_IDENTITY: 'UNRESOLVED_IDENTITY',
  PIPELINE_ERROR:      'PIPELINE_ERROR',
});

class QuarantineStore {
  constructor() {
    /** @type {Map<string, object>} quarantine_id → record */
    this._records = new Map();
  }

  /**
   * Persist a quarantine record.
   *
   * @param {object} ingestRecord   the ci_graph_ingest record being quarantined
   * @param {string} reason         one of QUARANTINE_REASON values
   * @param {string} detail         human-readable diagnostic (sanitized before storage)
   * @returns {object}              the quarantine record
   */
  add(ingestRecord, reason, detail = '') {
    // Sanitize: strip any potential secrets / large payloads from detail
    const safeDetail = String(detail)
      .replace(/(?:token|secret|password|key|auth)[^\s]*/gi, '[REDACTED]')
      .slice(0, 500);

    const record = {
      quarantine_id:  crypto.randomUUID(),
      ingest_id:      ingestRecord.ingest_id,
      source_repo:    ingestRecord.source_repo,
      source_ref:     ingestRecord.source_ref,
      path:           ingestRecord.path,
      blob_sha:       ingestRecord.blob_sha ?? null,
      content_hash:   ingestRecord.content_hash ?? null,
      reason,
      detail:         safeDetail,
      quarantined_at: new Date().toISOString(),
      resolved:       false,
      resolved_at:    null,
      resolved_by:    null,
    };

    this._records.set(record.quarantine_id, record);
    return record;
  }

  /**
   * Mark a quarantine record as resolved (e.g. after manual reprocessing).
   *
   * @param {string} quarantine_id
   * @param {string} resolved_by
   * @returns {object|null}
   */
  resolve(quarantine_id, resolved_by = 'operator') {
    const rec = this._records.get(quarantine_id);
    if (!rec) return null;
    rec.resolved    = true;
    rec.resolved_at = new Date().toISOString();
    rec.resolved_by = resolved_by;
    return rec;
  }

  /**
   * Return all quarantine records, optionally filtered by ingest_id.
   *
   * @param {string|null} ingest_id
   * @returns {Array<object>}
   */
  list(ingest_id = null) {
    const all = Array.from(this._records.values());
    return ingest_id ? all.filter((r) => r.ingest_id === ingest_id) : all;
  }

  get(quarantine_id) {
    return this._records.get(quarantine_id) ?? null;
  }

  /** @returns {number} */
  get size() { return this._records.size; }
}

module.exports = { QuarantineStore, QUARANTINE_REASON };
