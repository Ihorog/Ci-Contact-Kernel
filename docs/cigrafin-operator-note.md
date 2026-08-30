# Cigrafin Ingestion Pipeline — Operator Note

## Overview

The **Cigrafin** ingestion pipeline (`src/cigraph/ingest/`) provides a universal
raw-intake mailbox for Ci Graph.  It accepts arbitrary data from the
[`Ihorog/ci-memory/Cigrafin`](https://github.com/Ihorog/ci-memory/tree/main/Cigrafin)
source repository, preserves raw provenance, detects changes, classifies
content through the canonical Ci Graph classifier, and routes normalized outputs
into Ci+.

`Cigrafin` is a **transport inbox only**.  It assigns transport metadata
(`ingest_id`, `received_at`, `content_hash`, …) but never makes canonical
semantic decisions at the source.

---

## Module Structure

```
src/cigraph/ingest/
├── sourceAdapter.js        Source-independent intake contract (SourceItem shape)
├── githubCigrafinAdapter.js GitHub tree/commit/blob reader (poll + webhook modes)
├── dedupe.js               Hash/source-identity deduplication
├── mediaDetector.js        Content/media type detection (extension + magic bytes)
├── parserRegistry.js       Parser selection and execution by media type
├── claimExtractor.js       Atomic candidate claim extraction
├── quarantine.js           Quarantine store for unresolved/failed items
├── ingestCheckpoint.js     Source-revision checkpoint persistence
└── pipeline.js             Orchestrator — ingestCigrafinItem / runCigrafinScan
```

---

## Trigger Modes

### A. Push / Event Mode (preferred)

When source-side GitHub integration exists, post a GitHub push/webhook payload
to the Cigrafin webhook endpoint:

```
POST /cigrafin/webhook
Content-Type: application/json

{ "ref": "refs/heads/main", "after": "<commit-sha>",
  "head_commit": { "added": ["Cigrafin/note.txt"], "modified": [], "removed": [] } }
```

The adapter reads only changed paths listed in the payload, resolves blob SHAs,
and ingests only the affected items.

### B. Polling Mode (fallback)

Trigger a full scan by calling the internal API or the HTTP endpoint:

**Internal:**
```js
const { runCigrafinScan } = require('./src/cigraph/ingest/pipeline');
await runCigrafinScan(process.env, { operator: 'scheduler' });
```

**HTTP (requires operator identity):**
```
POST /cigrafin/scan
x-ci-operator-id: <operator-id>
```

The poller compares each blob's `blob_sha` + `content_hash` against persisted
dedup records and processes only new/changed items.  Re-scanning the same
unchanged commit is safe and idempotent.

---

## Required Runtime Configuration

| Environment Variable         | Default                   | Description |
|------------------------------|---------------------------|-------------|
| `CIGRAFIN_SOURCE_REPO`       | `Ihorog/ci-memory`        | Source repository (`owner/name`) |
| `CIGRAFIN_SOURCE_REF`        | `main`                    | Branch/ref to poll |
| `CIGRAFIN_SOURCE_PATH`       | `Cigrafin`                | Subdirectory prefix to filter |
| `CIGRAFIN_GITHUB_TOKEN`      | *(none)*                  | PAT or GitHub App token for API access (optional for public repos) |
| `CIGRAFIN_MAX_BLOB_BYTES`    | `524288` (512 KiB)        | Maximum blob size to fetch; larger files → QUARANTINED |

**Secret handling:** `CIGRAFIN_GITHUB_TOKEN` is used only as an HTTP
`Authorization` header.  It is never logged or stored in graph records.

---

## HTTP API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/cigrafin/status` | Read-only summary of ingest records and quarantine counts |
| `GET`  | `/cigrafin/ingest/:id` | Detail for one ingest record by `ingest_id` |
| `GET`  | `/cigrafin/quarantine` | List all quarantine records |
| `POST` | `/cigrafin/reprocess/:id` | Manually reprocess a quarantined item (requires `x-ci-operator-id` header) |
| `POST` | `/cigrafin/scan` | Trigger a full poll scan (requires `x-ci-operator-id` header) |
| `POST` | `/cigrafin/webhook` | Accept a push-style webhook payload from the source repository |

> **Note:** A scan trigger is NOT automatic approval for external writes.
> The scan only reads the source repository and processes items through the
> existing classifier.  Canonical graph mutations are gated by the same
> permission/approval rules as all other Ci Contact Kernel operations.

---

## Idempotency Keys

An ingest record is considered a duplicate when ALL of the following match a
previously processed record:

- `source_repo`
- `source_ref`
- `path`
- `blob_sha` (when available)
- `content_hash`

Reprocessing after a parser or classifier version upgrade creates a **new
classification run** linked to the original `ingest_id`.  Original provenance
and hash are always retained.

---

## Ingest Statuses

| Status              | Meaning |
|---------------------|---------|
| `RECEIVED`          | Item observed; content not yet fetched |
| `HASHED`            | Content fetched and SHA-256 hash computed |
| `DETECTED`          | Media type identified |
| `PARSED`            | Content parsed into normalized representation |
| `CLAIMS_EXTRACTED`  | Atomic candidate claims produced |
| `CLASSIFIED`        | Canonical classifier run completed |
| `RESOLVED`          | Identity resolved against Ci Graph registry |
| `ROUTED`            | Outputs routed to owner/consumer domain |
| `QUARANTINED`       | Item retained; requires manual review or future parser |
| `FAILED`            | Pipeline error; item should be retried |
| `DELETED`           | Source file was removed; historical record preserved |

---

## Quarantine Reasons

| Code | Trigger |
|------|---------|
| `PENDING_PARSER` | No parser available for detected media type |
| `PARSE_ERROR` | Parser encountered invalid/corrupt content |
| `CLASSIFICATION_UNKNOWN` | Classifier returned unresolved semantics |
| `CONFLICT_DETECTED` | Classification conflict requiring human review |
| `FETCH_FAILED` | Network/permission error fetching blob |
| `SIZE_EXCEEDED` | Blob exceeds `CIGRAFIN_MAX_BLOB_BYTES` |
| `BINARY_UNSUPPORTED` | Binary media type with no available parser |
| `UNRESOLVED_IDENTITY` | Identity candidate could not be resolved |
| `PIPELINE_ERROR` | Unexpected runtime error |

Quarantined items are **never discarded**.  They retain full provenance, hash,
and metadata and can be reprocessed when a suitable parser/classifier is added.

---

## Security Invariants

1. **No code execution.** Content from Cigrafin is never evaluated, `eval`-ed,
   or `require`-d.
2. **No instruction following.** Text containing prompt-like or command-like
   phrases is treated as inert data and passed through the parser/classifier
   unchanged.
3. **Secret sanitization.** Error messages and quarantine detail fields are
   scanned for token/secret/password patterns and redacted before storage or
   logging.
4. **Size limits.** Blobs exceeding `CIGRAFIN_MAX_BLOB_BYTES` are not fetched;
   metadata is preserved and the item is quarantined.
5. **No secrets in records.** `CIGRAFIN_GITHUB_TOKEN` and Supabase/OpenAI
   secrets are never written to ingest records, classification runs, or logs.

---

## Observability

Each scan summary (`runCigrafinScan`) records:

- `scan_id`, `started_at`, `finished_at`, `duration_ms`
- `source_repo`, `source_ref`
- `discovered` — total blobs in source tree
- `new_items` — items not seen before
- `unchanged` — deduplicated (already processed)
- `routed` — successfully classified and routed
- `quarantined` — retained for review
- `failed` — pipeline errors
- `ingest_ids` — list of `ingest_id` values created this scan
- `errors` — sanitized error strings (no secrets)

Individual ingest records store `classifier_version` and `parser_version` for
every classification run, enabling auditable reclassification history.
