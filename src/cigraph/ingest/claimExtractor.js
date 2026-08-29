'use strict';

/**
 * claimExtractor — produces atomic candidate claims from parsed content.
 *
 * Claims are transport representations: they carry extracted text/fields but
 * are NOT yet classified or verified.  The pipeline feeds them into the
 * canonical classifier (src/cigraph/classify.js) in a subsequent step.
 *
 * Security: this module treats all input as inert data.  Any text that looks
 * like a system instruction, prompt, or command is passed through unchanged
 * as a data claim — it is NEVER interpreted as an instruction.
 */

const { PARSER_VERSION } = require('./parserRegistry');

const EXTRACTOR_VERSION = 'cigrafin-extractor-1.0';

/**
 * Extract atomic candidate claims from a parse result.
 *
 * @param {object} parseResult   result from parserRegistry.parseContent()
 * @param {object} provenance    source provenance (source_repo, path, ingest_id, …)
 * @returns {Array<object>}      array of candidate claim objects
 */
function extractClaims(parseResult, provenance = {}) {
  const claims = [];
  const base = {
    extractor_version: EXTRACTOR_VERSION,
    parser_version:    parseResult.parser_version ?? PARSER_VERSION,
    provenance,
  };

  if (!parseResult.parsed || parseResult.body == null) {
    // Emit a single metadata-only claim for quarantine/pending items.
    claims.push({
      ...base,
      claim_type: 'metadata_only',
      text:       null,
      fields:     parseResult.fields ?? {},
      error:      parseResult.error ?? null,
    });
    return claims;
  }

  switch (parseResult.type) {
    case 'json': {
      // Each top-level key→value pair becomes one claim.
      const fields = parseResult.fields;
      if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
        for (const [key, value] of Object.entries(fields)) {
          claims.push({
            ...base,
            claim_type: 'json_field',
            text:       `${key}: ${JSON.stringify(value)}`,
            fields:     { key, value },
          });
        }
      }
      if (Array.isArray(fields)) {
        for (let i = 0; i < fields.length; i++) {
          claims.push({
            ...base,
            claim_type: 'json_array_item',
            text:       JSON.stringify(fields[i]),
            fields:     { index: i, value: fields[i] },
          });
        }
      }
      if (!claims.length) {
        // Empty JSON object/array → single raw claim
        claims.push({ ...base, claim_type: 'json_raw', text: parseResult.body, fields: {} });
      }
      break;
    }

    case 'yaml': {
      for (const [key, value] of Object.entries(parseResult.fields ?? {})) {
        claims.push({
          ...base,
          claim_type: 'yaml_field',
          text:       `${key}: ${value}`,
          fields:     { key, value },
        });
      }
      if (!claims.length) {
        claims.push({ ...base, claim_type: 'yaml_raw', text: parseResult.body, fields: {} });
      }
      break;
    }

    case 'markdown': {
      const { headings = [], paragraphs = [] } = parseResult.fields ?? {};
      for (const heading of headings) {
        claims.push({ ...base, claim_type: 'heading', text: heading, fields: { heading } });
      }
      for (const paragraph of paragraphs) {
        if (paragraph.trim()) {
          claims.push({ ...base, claim_type: 'paragraph', text: paragraph, fields: {} });
        }
      }
      if (!claims.length) {
        claims.push({ ...base, claim_type: 'markdown_raw', text: parseResult.body, fields: {} });
      }
      break;
    }

    default: {
      // plain_text and all other text types → single claim
      claims.push({
        ...base,
        claim_type: 'text',
        text:       parseResult.body,
        fields:     parseResult.fields ?? {},
      });
    }
  }

  return claims;
}

module.exports = { extractClaims, EXTRACTOR_VERSION };
