'use strict';

/**
 * pipeline — Cigrafin ingestion pipeline orchestrator.
 *
 * Exposes:
 *   ingestCigrafinItem(sourceItem, context)  → ingest result
 *   runCigrafinScan(env, context)            → scan summary
 *   reprocessIngestItem(ingest_id, context)  → ingest result
 *
 * Processing sequence (per spec):
 *  1.  Observe source commit/path/blob metadata.
 *  2.  Fetch content when supported and allowed.
 *  3.  Compute/validate content hash.
 *  4.  Create ci_graph_ingest record with RECEIVED/HASHED state.
 *  5.  Detect media/structure.
 *  6.  Parse into safe normalized transport representation.
 *  7.  Extract atomic candidate claims.
 *  8.  Call canonical classifier.
 *  9.  Resolve identity candidates.
 *  10. Persist classification run and results.
 *  11. Detect unresolved semantics/conflicts.
 *  12. Route resolved outputs.
 *  13. Mark ingest RESOLVED/ROUTED or QUARANTINED/FAILED.
 *  14. Persist source checkpoint after durable state is recorded.
 *
 * Security invariants:
 *   - Content is NEVER executed.
 *   - Embedded instructions are treated as data only.
 *   - Secrets are never logged.
 */

const crypto  = require('crypto');

const { validateSourceItem, INGEST_STATUS } = require('./sourceAdapter');
const { computeContentHash, DedupStore }    = require('./dedupe');
const { detectMediaType, isBinaryMedia }    = require('./mediaDetector');
const { parseContent }                      = require('./parserRegistry');
const { extractClaims }                     = require('./claimExtractor');
const { QuarantineStore, QUARANTINE_REASON }= require('./quarantine');
const { IngestCheckpointStore }             = require('./ingestCheckpoint');
const { pollCigrafinItems }                 = require('./githubCigrafinAdapter');
const { classifyCiGraph }                   = require('../classify');
const { CLASSIFIER_VERSION }               = require('../registry');

// ── Shared in-process state (swap for persistent adapters in production) ──────

const _dedupe     = new DedupStore();
const _quarantine = new QuarantineStore();
const _checkpoint = new IngestCheckpointStore();

/** @type {Map<string, object>}  ingest_id → ci_graph_ingest record */
const _ingestRecords = new Map();

/** @type {Map<string, Array<object>>}  ingest_id → classification runs */
const _classificationRuns = new Map();

// ── Internal helpers ──────────────────────────────────────────────────────────

function _now() { return new Date().toISOString(); }

function _createIngestRecord(item, contentHash, status) {
  return {
    ingest_id:    crypto.randomUUID(),
    source_repo:  item.source_repo,
    source_ref:   item.source_ref,
    path:         item.path,
    blob_sha:     item.blob_sha      ?? null,
    content_hash: contentHash        ?? null,
    media_type:   item.media_type    ?? null,
    size_bytes:   item.size_bytes    ?? null,
    source_type:  item.source_type,
    ingest_status:status,
    received_at:  _now(),
    updated_at:   _now(),
    deleted:      item.deleted,
    raw_metadata: item.raw_metadata  ?? {},
    classification_runs: [],
  };
}

function _updateStatus(record, status) {
  record.ingest_status = status;
  record.updated_at    = _now();
}

/**
 * Safe content fetch — returns Buffer or null.  Never throws; errors are
 * returned as an error string.
 *
 * @param {object} item  SourceItem
 * @returns {Promise<{content: Buffer|null, error: string|null}>}
 */
async function _safeFetch(item) {
  if (typeof item.fetch !== 'function') {
    return { content: null, error: null };
  }
  try {
    const result = await item.fetch();
    if (result == null) return { content: null, error: null };
    return { content: Buffer.isBuffer(result) ? result : Buffer.from(result), error: null };
  } catch (err) {
    // Sanitize error message before logging — never include tokens/secrets
    const safe = String(err.message)
      .replace(/(?:token|secret|password|key|auth)\S*/gi, '[REDACTED]')
      .slice(0, 300);
    return { content: null, error: `CIGRAFIN_ERR_FETCH: ${safe}` };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Ingest a single Cigrafin source item through the full pipeline.
 *
 * @param {object} sourceItem   conforms to SourceItem contract
 * @param {object} [context]    optional context (operator, run_id, …)
 * @returns {Promise<object>}   ingest result summary
 */
async function ingestCigrafinItem(sourceItem, context = {}) {
  validateSourceItem(sourceItem);
  const startedAt = Date.now();

  // ── 1. Observe metadata ───────────────────────────────────────────────────
  // (already in sourceItem)

  // ── 2. Fetch content ──────────────────────────────────────────────────────
  const { content, error: fetchError } = await _safeFetch(sourceItem);

  // ── 3. Compute content hash ───────────────────────────────────────────────
  const contentHash = computeContentHash(content);

  // ── 4. Create ingest record ───────────────────────────────────────────────
  const status  = contentHash ? INGEST_STATUS.HASHED : INGEST_STATUS.RECEIVED;
  let record  = _createIngestRecord(sourceItem, contentHash, status);
  _ingestRecords.set(record.ingest_id, record);

  // ── Handle deleted source ─────────────────────────────────────────────────
  if (sourceItem.deleted) {
    _updateStatus(record, INGEST_STATUS.DELETED);
    return _buildResult(record, [], startedAt, 'source_deleted');
  }

  // ── Check dedup ───────────────────────────────────────────────────────────
  const identity = {
    source_repo:  record.source_repo,
    source_ref:   record.source_ref,
    path:         record.path,
    blob_sha:     record.blob_sha,
    content_hash: record.content_hash,
  };
  const { duplicate, existingIngestId } = _dedupe.check(identity);
  if (duplicate) {
    const existingRuns = _classificationRuns.get(existingIngestId) ?? [];
    const alreadyClassifiedWithCurrentVersion = existingRuns
      .some((run) => run?.classifier_version === CLASSIFIER_VERSION);

    if (!alreadyClassifiedWithCurrentVersion) {
      const existingRecord = _ingestRecords.get(existingIngestId);
      if (existingRecord) {
        _ingestRecords.delete(record.ingest_id);
        record = existingRecord;
        _updateStatus(record, status);
      } else {
        _updateStatus(record, INGEST_STATUS.RESOLVED);
        return _buildResult(record, [], startedAt, 'duplicate', { existingIngestId });
      }
    } else {
      _updateStatus(record, INGEST_STATUS.RESOLVED);
      return _buildResult(record, [], startedAt, 'duplicate', { existingIngestId });
    }
  }

  // ── Handle fetch failure ──────────────────────────────────────────────────
  if (fetchError) {
    _updateStatus(record, INGEST_STATUS.QUARANTINED);
    const qr = _quarantine.add(record, QUARANTINE_REASON.FETCH_FAILED, fetchError);
    return _buildResult(record, [], startedAt, 'quarantined', { quarantine_id: qr.quarantine_id });
  }

  // ── 5. Detect media type ──────────────────────────────────────────────────
  const mediaType = detectMediaType(sourceItem, content);
  record.media_type = mediaType;
  _updateStatus(record, INGEST_STATUS.DETECTED);

  // ── Quarantine binary/unsupported before parsing ──────────────────────────
  if (content === null || isBinaryMedia(mediaType)) {
    const reason = content === null
      ? QUARANTINE_REASON.SIZE_EXCEEDED
      : QUARANTINE_REASON.BINARY_UNSUPPORTED;
    _updateStatus(record, INGEST_STATUS.QUARANTINED);
    const qr = _quarantine.add(record, reason, `media_type=${mediaType}`);
    _dedupe.record(identity, record.ingest_id);
    return _buildResult(record, [], startedAt, 'quarantined', { quarantine_id: qr.quarantine_id });
  }

  // ── 6. Parse ──────────────────────────────────────────────────────────────
  const parseResult = parseContent(mediaType, content);
  _updateStatus(record, INGEST_STATUS.PARSED);

  if (!parseResult.parsed) {
    const reason = parseResult.error?.startsWith('CIGRAFIN_ERR_PENDING_PARSER')
      ? QUARANTINE_REASON.PENDING_PARSER
      : QUARANTINE_REASON.PARSE_ERROR;
    _updateStatus(record, INGEST_STATUS.QUARANTINED);
    const qr = _quarantine.add(record, reason, parseResult.error ?? '');
    _dedupe.record(identity, record.ingest_id);
    return _buildResult(record, [], startedAt, 'quarantined', { quarantine_id: qr.quarantine_id });
  }

  // ── 7. Extract candidate claims ───────────────────────────────────────────
  const provenance = {
    ingest_id:   record.ingest_id,
    source_repo: record.source_repo,
    source_ref:  record.source_ref,
    path:        record.path,
    blob_sha:    record.blob_sha,
    content_hash: record.content_hash,
  };
  const claims = extractClaims(parseResult, provenance);
  _updateStatus(record, INGEST_STATUS.CLAIMS_EXTRACTED);

  // ── 8–10. Classify each claim via canonical classifier ────────────────────
  const classificationRun = {
    run_id:             crypto.randomUUID(),
    ingest_id:          record.ingest_id,
    classifier_version: CLASSIFIER_VERSION,
    started_at:         _now(),
    claims:             [],
    unresolved:         [],
    conflicts:          [],
  };

  for (const claim of claims) {
    const classifierInput = {
      text:        claim.text,
      ...claim.fields,
      provenance,
    };
    let classResult;
    try {
      classResult = classifyCiGraph(classifierInput, { ingest_id: record.ingest_id });
    } catch (err) {
      classResult = { canonicalRecord: null, unresolved: [claim.text ?? claim.claim_type], reasons: [] };
    }

    classificationRun.claims.push({
      claim,
      canonical_record: classResult.canonicalRecord ?? null,
      candidates:       classResult.candidates      ?? [],
      unresolved:       classResult.unresolved       ?? [],
      reasons:          classResult.reasons           ?? [],
    });

    if (classResult.unresolved?.length) {
      classificationRun.unresolved.push(...classResult.unresolved);
    }
  }

  classificationRun.finished_at = _now();
  _classificationRuns.set(record.ingest_id, [
    ...(_classificationRuns.get(record.ingest_id) ?? []),
    classificationRun,
  ]);
  record.classification_runs = _classificationRuns.get(record.ingest_id);
  _updateStatus(record, INGEST_STATUS.CLASSIFIED);

  // ── 11. Detect unresolved / conflicts ────────────────────────────────────
  const hasUnresolved = classificationRun.unresolved.length > 0;

  if (hasUnresolved) {
    _updateStatus(record, INGEST_STATUS.QUARANTINED);
    const qr = _quarantine.add(record, QUARANTINE_REASON.CLASSIFICATION_UNKNOWN,
      `unresolved: ${classificationRun.unresolved.slice(0, 3).join(', ')}`);
    _dedupe.record(identity, record.ingest_id);
    return _buildResult(record, classificationRun.claims, startedAt, 'quarantined',
      { quarantine_id: qr.quarantine_id });
  }

  // ── 12–13. Route and mark resolved ───────────────────────────────────────
  _updateStatus(record, INGEST_STATUS.ROUTED);
  _dedupe.record(identity, record.ingest_id);

  return _buildResult(record, classificationRun.claims, startedAt, 'routed');
}

/**
 * Run a full polling scan of the Cigrafin mailbox.
 *
 * @param {object} env      process.env or config object
 * @param {object} context  optional context
 * @returns {Promise<object>} scan summary
 */
async function runCigrafinScan(env = {}, context = {}) {
  const scanStarted = Date.now();
  const summary = {
    scan_id:      crypto.randomUUID(),
    started_at:   _now(),
    source_repo:  env.CIGRAFIN_SOURCE_REPO ?? 'Ihorog/ci-memory',
    source_ref:   env.CIGRAFIN_SOURCE_REF  ?? 'main',
    discovered:   0,
    new_items:    0,
    unchanged:    0,
    failed:       0,
    quarantined:  0,
    routed:       0,
    ingest_ids:   [],
    errors:       [],
  };

  let items;
  try {
    items = await pollCigrafinItems(env);
  } catch (err) {
    const safe = String(err.message).replace(/\S*(?:token|secret|key)\S*/gi, '[REDACTED]').slice(0, 300);
    summary.errors.push(`CIGRAFIN_ERR_POLL: ${safe}`);
    summary.finished_at  = _now();
    summary.duration_ms  = Date.now() - scanStarted;
    return summary;
  }

  summary.discovered = items.length;

  for (const item of items) {
    try {
      const result = await ingestCigrafinItem(item, context);
      summary.ingest_ids.push(result.ingest_id);

      switch (result.outcome) {
        case 'duplicate':   summary.unchanged++;   break;
        case 'routed':      summary.routed++;      summary.new_items++; break;
        case 'quarantined': summary.quarantined++; summary.new_items++; break;
        case 'source_deleted': /* counted separately */ break;
        default:            summary.new_items++;
      }
    } catch (err) {
      summary.failed++;
      const safe = String(err.message).slice(0, 200);
      summary.errors.push(`CIGRAFIN_ERR_ITEM[${item.path}]: ${safe}`);
    }
  }

  // ── 14. Persist checkpoint after durable state recorded ──────────────────
  if (items.length > 0 && summary.failed === 0) {
    const repoUrl = `https://github.com/${env.CIGRAFIN_SOURCE_REPO ?? 'Ihorog/ci-memory'}`;
    const ref     = env.CIGRAFIN_SOURCE_REF ?? 'main';
    const commitSha = items[0]?.raw_metadata?.commit_sha ?? null;
    if (commitSha) {
      _checkpoint.save(repoUrl, ref, commitSha, summary.discovered);
    }
  }

  summary.finished_at = _now();
  summary.duration_ms = Date.now() - scanStarted;
  return summary;
}

/**
 * Reprocess a previously quarantined/failed ingest item by ingest_id.
 * Creates a new classification run while preserving original provenance.
 *
 * @param {string} ingest_id
 * @param {object} context
 * @returns {Promise<object>}
 */
async function reprocessIngestItem(ingest_id, context = {}) {
  const record = _ingestRecords.get(ingest_id);
  if (!record) {
    throw new Error(`CIGRAFIN_ERR_NOT_FOUND: ingest_id=${ingest_id}`);
  }

  // Remove dedup entry so reprocessing is allowed
  _dedupe.forget({
    source_repo:  record.source_repo,
    source_ref:   record.source_ref,
    path:         record.path,
    blob_sha:     record.blob_sha,
    content_hash: record.content_hash,
  });

  // Rebuild a synthetic SourceItem from the stored record (content not re-fetched)
  const { createSourceItem } = require('./sourceAdapter');
  const syntheticItem = createSourceItem({
    source_repo:  record.source_repo,
    source_ref:   record.source_ref,
    path:         record.path,
    blob_sha:     record.blob_sha,
    media_type:   record.media_type,
    size_bytes:   record.size_bytes,
    source_type:  record.source_type,
    deleted:      record.deleted,
    fetch:        null, // content not available without re-fetch
    raw_metadata: record.raw_metadata,
  });

  return ingestCigrafinItem(syntheticItem, { ...context, reprocess: true, original_ingest_id: ingest_id });
}

// ── Status accessors ──────────────────────────────────────────────────────────

function getIngestRecord(ingest_id) {
  return _ingestRecords.get(ingest_id) ?? null;
}

function listIngestRecords() {
  return Array.from(_ingestRecords.values());
}

function getQuarantine() { return _quarantine; }
function getCheckpoint()  { return _checkpoint; }

// ── Internal ──────────────────────────────────────────────────────────────────

function _buildResult(record, claims, startedAt, outcome, extra = {}) {
  return {
    ingest_id:     record.ingest_id,
    ingest_status: record.ingest_status,
    source_repo:   record.source_repo,
    source_ref:    record.source_ref,
    path:          record.path,
    blob_sha:      record.blob_sha,
    content_hash:  record.content_hash,
    media_type:    record.media_type,
    outcome,
    claims_count:  claims.length,
    duration_ms:   Date.now() - startedAt,
    ...extra,
  };
}

module.exports = {
  ingestCigrafinItem,
  runCigrafinScan,
  reprocessIngestItem,
  getIngestRecord,
  listIngestRecords,
  getQuarantine,
  getCheckpoint,
};
