'use strict';

/**
 * parserRegistry — selects and runs a parser appropriate for a media type.
 *
 * Baseline parsers:
 *   text/plain             → plain text (whole content as one claim)
 *   text/markdown          → Markdown (strips formatting, extracts headings/paragraphs)
 *   application/json       → JSON (validates, normalizes to object)
 *   application/x-yaml     → YAML (simple key:value line parser, no external deps)
 *   filename/path metadata → always available as provenance
 *
 * Binary / unsupported types are NOT parsed.  The registry returns a
 * PENDING_PARSER result so the pipeline can quarantine gracefully.
 *
 * Security: parsers must treat content as inert data.
 *   - No eval, no dynamic require, no script execution.
 *   - Content size is assumed pre-limited by the adapter.
 */

const PARSER_VERSION = 'cigrafin-parser-1.0';

// ── Parsers ───────────────────────────────────────────────────────────────────

function parsePlainText(content) {
  const text = content.toString('utf8').trim();
  return { parsed: true, type: 'plain_text', body: text, fields: {}, parser_version: PARSER_VERSION };
}

function parseMarkdown(content) {
  const raw = content.toString('utf8');
  const lines = raw.split('\n');
  const headings = lines
    .filter((l) => /^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^#{1,6}\s+/, '').trim());
  const paragraphs = [];
  let buf = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (buf.length) { paragraphs.push(buf.join(' ').trim()); buf = []; }
    } else if (!/^#{1,6}\s/.test(line) && !/^[-*>]/.test(line.trim())) {
      buf.push(line.trim());
    }
  }
  if (buf.length) paragraphs.push(buf.join(' ').trim());
  return {
    parsed: true,
    type: 'markdown',
    body: raw.trim(),
    fields: { headings, paragraphs },
    parser_version: PARSER_VERSION,
  };
}

function parseJson(content) {
  const raw = content.toString('utf8').trim();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return {
      parsed: false,
      type: 'json',
      body: raw,
      fields: {},
      error: `CIGRAFIN_ERR_INVALID_JSON: ${err.message}`,
      parser_version: PARSER_VERSION,
    };
  }
  return { parsed: true, type: 'json', body: raw, fields: data, parser_version: PARSER_VERSION };
}

function parseYaml(content) {
  // Minimal key: value parser — no external library required.
  // Handles simple flat YAML only; nested structures are preserved as raw body.
  const raw = content.toString('utf8').trim();
  const fields = {};
  let parseError = null;
  for (const line of raw.split('\n')) {
    const stripped = line.replace(/#.*$/, '').trimEnd();
    if (!stripped || stripped.startsWith(' ') || stripped.startsWith('\t')) continue;
    const colonIdx = stripped.indexOf(':');
    if (colonIdx < 1) continue;
    const key = stripped.slice(0, colonIdx).trim();
    const val = stripped.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) fields[key] = val;
  }
  return {
    parsed: parseError === null,
    type: 'yaml',
    body: raw,
    fields,
    error: parseError,
    parser_version: PARSER_VERSION,
  };
}

function parsePending(mediaType) {
  return {
    parsed: false,
    type: 'pending',
    body: null,
    fields: {},
    error: `CIGRAFIN_ERR_PENDING_PARSER: no parser available for ${mediaType}`,
    parser_version: PARSER_VERSION,
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────

const PARSER_MAP = new Map([
  ['text/plain',           parsePlainText],
  ['text/markdown',        parseMarkdown],
  ['application/json',     parseJson],
  ['application/x-yaml',   parseYaml],
  ['application/javascript', parsePlainText],
  ['application/typescript', parsePlainText],
  ['text/html',            parsePlainText],
  ['text/csv',             parsePlainText],
  ['text/x-python',        parsePlainText],
  ['text/x-ruby',          parsePlainText],
  ['application/x-sh',     parsePlainText],
]);

/**
 * Select a parser for the given media type and parse the content Buffer.
 *
 * @param {string} mediaType
 * @param {Buffer} content
 * @returns {object}  parse result
 */
function parseContent(mediaType, content) {
  const parser = PARSER_MAP.get(mediaType);
  if (!parser) return parsePending(mediaType);
  try {
    return parser(content);
  } catch (err) {
    return {
      parsed: false,
      type: mediaType,
      body: null,
      fields: {},
      error: `CIGRAFIN_ERR_PARSER_EXCEPTION: ${err.message}`,
      parser_version: PARSER_VERSION,
    };
  }
}

/**
 * Register a custom parser for a media type.  Allows extension without
 * modifying this file.
 *
 * @param {string} mediaType
 * @param {(content: Buffer) => object} parserFn
 */
function registerParser(mediaType, parserFn) {
  if (typeof parserFn !== 'function') throw new TypeError('parserFn must be a function');
  PARSER_MAP.set(mediaType, parserFn);
}

module.exports = { parseContent, registerParser, PARSER_VERSION };
