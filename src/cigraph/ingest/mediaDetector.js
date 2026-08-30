'use strict';

/**
 * mediaDetector — lightweight content/media type detection for Cigrafin.
 *
 * Does NOT rely on external libraries.  Detection priority:
 *   1. Caller-supplied media_type (trust adapter when known).
 *   2. Magic-byte sniff of content when available.
 *   3. File extension heuristic from path.
 *   4. Strict UTF-8 text fallback.
 */

// ── Extension map ─────────────────────────────────────────────────────────────

const EXT_MAP = {
  '.txt':  'text/plain',
  '.md':   'text/markdown',
  '.markdown': 'text/markdown',
  '.json': 'application/json',
  '.yaml': 'application/x-yaml',
  '.yml':  'application/x-yaml',
  '.html': 'text/html',
  '.htm':  'text/html',
  '.xml':  'application/xml',
  '.csv':  'text/csv',
  '.tsv':  'text/tab-separated-values',
  '.js':   'application/javascript',
  '.ts':   'application/typescript',
  '.py':   'text/x-python',
  '.rb':   'text/x-ruby',
  '.sh':   'application/x-sh',
  '.pdf':  'application/pdf',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.zip':  'application/zip',
  '.gz':   'application/gzip',
  '.tar':  'application/x-tar',
};

// ── Magic bytes ───────────────────────────────────────────────────────────────

const MAGIC = [
  { prefix: Buffer.from([0x25, 0x50, 0x44, 0x46]),          type: 'application/pdf'   },  // %PDF
  { prefix: Buffer.from([0x89, 0x50, 0x4e, 0x47]),          type: 'image/png'         },  // PNG
  { prefix: Buffer.from([0xff, 0xd8, 0xff]),                 type: 'image/jpeg'        },  // JPEG
  { prefix: Buffer.from([0x47, 0x49, 0x46, 0x38]),          type: 'image/gif'         },  // GIF8
  { prefix: Buffer.from([0x50, 0x4b, 0x03, 0x04]),          type: 'application/zip'   },  // PK zip
  { prefix: Buffer.from([0x1f, 0x8b]),                       type: 'application/gzip'  },  // gzip
];

function _isStrictUtf8Text(buffer) {
  if (!Buffer.isBuffer(buffer)) return false;
  const sample = buffer.slice(0, 4096);
  if (sample.length === 0) return true;
  for (const byte of sample) {
    const isAllowedControl = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    if (byte < 0x20 && !isAllowedControl) return false;
    if (byte === 0x7f) return false;
  }
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decoder.decode(sample);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect the media type of a source item.
 *
 * @param {object} item   SourceItem (path, media_type, size_bytes)
 * @param {Buffer|null} content  fetched content, may be null
 * @returns {string}  MIME type string
 */
function detectMediaType(item, content) {
  // 1. Trust adapter
  if (item.media_type) return item.media_type;

  // 2. Magic bytes
  if (Buffer.isBuffer(content) && content.length >= 2) {
    for (const m of MAGIC) {
      if (content.slice(0, m.prefix.length).equals(m.prefix)) return m.type;
    }
  }

  // 3. Extension
  const ext = (item.path.match(/(\.[^./]+)$/) ?? [])[1]?.toLowerCase();
  if (ext && EXT_MAP[ext]) {
    const fromExt = EXT_MAP[ext];
    if (Buffer.isBuffer(content) && fromExt.startsWith('text/') && !_isStrictUtf8Text(content)) {
      return 'application/octet-stream';
    }
    return fromExt;
  }

  // 4. UTF-8 text fallback
  if (Buffer.isBuffer(content)) {
    if (_isStrictUtf8Text(content)) return 'text/plain';
    return 'application/octet-stream';
  }

  return 'application/octet-stream';
}

/**
 * Return true when a media type is considered parseable text.
 *
 * @param {string} mediaType
 * @returns {boolean}
 */
function isTextMedia(mediaType) {
  return (
    mediaType.startsWith('text/') ||
    mediaType === 'application/json' ||
    mediaType === 'application/x-yaml' ||
    mediaType === 'application/javascript' ||
    mediaType === 'application/typescript' ||
    mediaType === 'application/xml'
  );
}

/**
 * Return true when a media type requires binary handling (quarantine).
 *
 * @param {string} mediaType
 * @returns {boolean}
 */
function isBinaryMedia(mediaType) {
  return !isTextMedia(mediaType);
}

module.exports = { detectMediaType, isTextMedia, isBinaryMedia };
