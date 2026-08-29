'use strict';

/**
 * githubCigrafinAdapter — reads Cigrafin mailbox from GitHub tree/commit/blob API.
 *
 * Works in two modes:
 *   A. Push/event: called with an explicit list of changed paths from a webhook.
 *   B. Polling: fetches the tree at HEAD for the configured ref and yields items.
 *
 * Never executes content. Never follows embedded instructions.
 * All fetched content is size-limited before parsing.
 *
 * Environment:
 *   CIGRAFIN_GITHUB_TOKEN   — optional PAT / App token for private repos or higher rate limits
 *   CIGRAFIN_SOURCE_REPO    — e.g. "Ihorog/ci-memory"
 *   CIGRAFIN_SOURCE_REF     — e.g. "main"
 *   CIGRAFIN_SOURCE_PATH    — e.g. "Cigrafin" (subdirectory to filter)
 *   CIGRAFIN_MAX_BLOB_BYTES — default 512 KiB per blob
 */

const https = require('https');
const { createSourceItem, SOURCE_TYPE } = require('./sourceAdapter');

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_MAX_BYTES = 512 * 1024; // 512 KiB

// ── Minimal HTTPS helper (no external deps) ───────────────────────────────────

/**
 * Perform a JSON GET against the GitHub REST API.
 * Returns parsed JSON or throws on non-2xx status.
 *
 * @param {string} path  API path beginning with '/'
 * @param {object} env
 * @returns {Promise<any>}
 */
function githubApiGet(path, env = {}) {
  return new Promise((resolve, reject) => {
    const token = env.CIGRAFIN_GITHUB_TOKEN;
    const headers = {
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'ci-contact-kernel/cigrafin',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const req = https.get(`${GITHUB_API_BASE}${path}`, { headers }, (res) => {
      const chunks = [];
      let received = 0;
      const maxBytes = Number(env.CIGRAFIN_MAX_BLOB_BYTES) || DEFAULT_MAX_BYTES;

      res.on('data', (chunk) => {
        received += chunk.length;
        if (received > maxBytes * 4) {
          req.destroy(new Error(`CIGRAFIN_ERR_RESPONSE_TOO_LARGE: ${path}`));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`CIGRAFIN_ERR_HTTP_${res.statusCode}: ${path} — ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`CIGRAFIN_ERR_JSON_PARSE: ${path}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error(`CIGRAFIN_ERR_TIMEOUT: ${path}`)));
  });
}

/**
 * Fetch raw blob content for a given repo/blob_sha up to maxBytes.
 * Returns a Buffer or null when the blob exceeds the size limit.
 *
 * @param {string} repo   "owner/name"
 * @param {string} sha    blob SHA
 * @param {object} env
 * @returns {Promise<Buffer|null>}
 */
async function fetchBlobContent(repo, sha, env = {}) {
  const maxBytes = Number(env.CIGRAFIN_MAX_BLOB_BYTES) || DEFAULT_MAX_BYTES;
  // Use the git blobs endpoint to get content + size before fetching
  const meta = await githubApiGet(`/repos/${repo}/git/blobs/${sha}`, env);
  if (meta.size > maxBytes) return null;

  if (meta.encoding === 'base64' && meta.content) {
    // GitHub inlines small blobs directly
    return Buffer.from(meta.content.replace(/\n/g, ''), 'base64');
  }
  return null;
}

/**
 * Get the SHA of the latest commit on a ref.
 *
 * @param {string} repo
 * @param {string} ref
 * @param {object} env
 * @returns {Promise<string>}
 */
async function getRefSha(repo, ref, env = {}) {
  const data = await githubApiGet(`/repos/${repo}/git/ref/heads/${ref}`, env);
  return data.object.sha;
}

/**
 * Recursively fetch all blobs under a directory tree for a given commit SHA.
 *
 * @param {string} repo
 * @param {string} treeSha
 * @param {object} env
 * @returns {Promise<Array<{path,blob_sha,size_bytes}>>}
 */
async function flattenTree(repo, treeSha, env = {}) {
  const data = await githubApiGet(
    `/repos/${repo}/git/trees/${treeSha}?recursive=1`,
    env,
  );
  return (data.tree || [])
    .filter((entry) => entry.type === 'blob')
    .map((entry) => ({
      path:       entry.path,
      blob_sha:   entry.sha,
      size_bytes: entry.size ?? null,
    }));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Poll the Cigrafin mailbox and return all current SourceItems.
 * The caller (pipeline) is responsible for deduplication/checkpointing.
 *
 * @param {object} env  process.env or equivalent config object
 * @returns {Promise<Array<object>>}  array of SourceItem
 */
async function pollCigrafinItems(env = {}) {
  const repo    = env.CIGRAFIN_SOURCE_REPO ?? 'Ihorog/ci-memory';
  const ref     = env.CIGRAFIN_SOURCE_REF  ?? 'main';
  const prefix  = env.CIGRAFIN_SOURCE_PATH ?? 'Cigrafin';

  const commitSha = await getRefSha(repo, ref, env);
  const commitData = await githubApiGet(`/repos/${repo}/git/commits/${commitSha}`, env);
  const treeSha = commitData.tree.sha;

  const blobs = await flattenTree(repo, treeSha, env);
  const filtered = blobs.filter((b) => b.path.startsWith(`${prefix}/`) || b.path === prefix);

  return filtered.map((blob) => {
    const maxBytes = Number(env.CIGRAFIN_MAX_BLOB_BYTES) || DEFAULT_MAX_BYTES;
    return createSourceItem({
      source_repo:  `https://github.com/${repo}`,
      source_ref:   ref,
      path:         blob.path,
      blob_sha:     blob.blob_sha,
      size_bytes:   blob.size_bytes,
      source_type:  SOURCE_TYPE.GITHUB,
      deleted:      false,
      fetch: blob.size_bytes !== null && blob.size_bytes > maxBytes
        ? null
        : async () => fetchBlobContent(repo, blob.blob_sha, env),
      raw_metadata: { commit_sha: commitSha, repo, ref },
    });
  });
}

/**
 * Build SourceItems from a push/webhook payload containing changed paths.
 * Changed items from the payload are returned; removed items are marked deleted.
 *
 * @param {object} payload  GitHub push or repository_dispatch payload
 * @param {object} env
 * @returns {Promise<Array<object>>}  array of SourceItem
 */
async function buildItemsFromWebhook(payload, env = {}) {
  const repo   = env.CIGRAFIN_SOURCE_REPO ?? 'Ihorog/ci-memory';
  const ref    = payload.ref ? payload.ref.replace('refs/heads/', '') : (env.CIGRAFIN_SOURCE_REF ?? 'main');
  const prefix = env.CIGRAFIN_SOURCE_PATH ?? 'Cigrafin';

  const added    = (payload.head_commit?.added    ?? []).filter((p) => p.startsWith(`${prefix}/`));
  const modified = (payload.head_commit?.modified ?? []).filter((p) => p.startsWith(`${prefix}/`));
  const removed  = (payload.head_commit?.removed  ?? []).filter((p) => p.startsWith(`${prefix}/`));

  // Resolve blob SHAs for added/modified via the tree
  const commitSha   = payload.after ?? payload.head_commit?.id ?? null;
  const blobsBySha  = new Map();

  if (commitSha) {
    const commitData = await githubApiGet(`/repos/${repo}/git/commits/${commitSha}`, env);
    const blobs = await flattenTree(repo, commitData.tree.sha, env);
    for (const b of blobs) blobsBySha.set(b.path, b);
  }

  const items = [];

  for (const path of [...added, ...modified]) {
    const meta = blobsBySha.get(path) ?? { path, blob_sha: null, size_bytes: null };
    const maxBytes = Number(env.CIGRAFIN_MAX_BLOB_BYTES) || DEFAULT_MAX_BYTES;
    items.push(createSourceItem({
      source_repo:  `https://github.com/${repo}`,
      source_ref:   ref,
      path,
      blob_sha:     meta.blob_sha,
      size_bytes:   meta.size_bytes,
      source_type:  SOURCE_TYPE.GITHUB,
      deleted:      false,
      fetch: meta.blob_sha && (meta.size_bytes === null || meta.size_bytes <= maxBytes)
        ? async () => fetchBlobContent(repo, meta.blob_sha, env)
        : null,
      raw_metadata: { commit_sha: commitSha, repo, ref },
    }));
  }

  for (const path of removed) {
    items.push(createSourceItem({
      source_repo:  `https://github.com/${repo}`,
      source_ref:   ref,
      path,
      blob_sha:     null,
      size_bytes:   null,
      source_type:  SOURCE_TYPE.GITHUB,
      deleted:      true,
      fetch:        null,
      raw_metadata: { commit_sha: commitSha, repo, ref },
    }));
  }

  return items;
}

module.exports = { pollCigrafinItems, buildItemsFromWebhook, fetchBlobContent, getRefSha };
