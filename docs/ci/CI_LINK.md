# Ci Link v1

## Purpose

Ci Link is the canonical remote contact between a Ci-aware client and Ci+.

The user experience is one contact point. Internal APIs, MCP tools, connectors, databases,
executors, skills and automation remain behind Ci+.

```text
user / AI
    ↓
POST /ci
    ↓
Ci+ authentication → context → route → policy → executor → verification → evidence
```

## Coordinate snapshot

A client may send a compact `surface` snapshot with the current verified capability map.
This is not a copy of the client itself. It may contain only safe operational metadata such as:

- capability classes;
- connector names and current states;
- contract or schema versions;
- project/environment identifiers that are safe to disclose;
- timestamps;
- evidence references.

The server removes fields whose names indicate secrets, tokens, passwords, cookies,
authorization data, API/private keys or credentials. Hidden system/developer instructions
must never be sent.

The most recent safe snapshot is stored under the authenticated principal in `CI_MEMORY_KV`
with a 30-day TTL. Every successful contact refreshes `lastSeenAt`; a supplied snapshot also
refreshes `lastSnapshotAt`.

## Modes

- `contact` — refresh link state and route an intent through the existing Ci control plane.
- `sync` — refresh the safe coordinate snapshot without creating a Ci task.
- `status` — return current contact/runtime state without creating a Ci task.

## Authentication

Ci Link fails closed. It uses `CI_LINK_TOKEN`; while migrating, it may reuse `CI_MCP_TOKEN`.
The token belongs in the remote runtime secret store and in the client's secure Action/API
auth configuration. It must never be placed in prompts, repository files, URLs or snapshots.

For multiple independent users, replace the shared bearer with per-user OAuth/session identity.
The `principal` field is only a logical coordinate and is not an authorization boundary.

## Adaptive / neural-link behavior

Ci Link is deliberately state-light on the client side and state-aware on the Ci+ side.
A contact can carry the current safe coordinate surface, allowing both sides to adapt without
requiring the user to manage tool lists or workflows.

The link is refreshed on use. The response includes `nextSyncSuggestedAt` as a fallback
checkpoint. A scheduler may later call `mode=sync` periodically, but no background sync is
claimed unless a real scheduler/executor is connected and verified.

## Acceptance

Ci Link is ACTIVE only when all of the following are evidenced:

1. `/ci` is deployed on `https://ciplus.cimeika.com.ua`.
2. server-side auth secret is configured;
3. an authorized client receives `link.state = VERIFIED_CONTACT`;
4. `durableSnapshot = true` when backup persistence is required;
5. an intent contact returns a Ci task and verification evidence.

Until then the repository implementation is READY/PENDING DEPLOYMENT, not a verified live link.
