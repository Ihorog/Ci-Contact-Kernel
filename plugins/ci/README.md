# Ci plugin package

## FACT

This package bundles the Ci orchestration skill and the remote Ci MCP server configuration.

The MCP endpoint is `https://mcp-http.cimeika.com.ua/mcp` and uses the Ci OAuth resource at `https://mcp-http.cimeika.com.ua`.

The plugin intentionally does not contain `.app.json` yet. A ChatGPT registered-app mapping must reference the real technical ID returned by ChatGPT Developer Mode; that ID must never be invented or guessed.

## PENDING

1. Register the Ci MCP server in ChatGPT Developer Mode.
2. Capture the actual registered technical app ID.
3. Add `plugins/ci/.app.json` and the manifest `apps` mapping using that exact ID.
4. Refresh/install the local plugin and verify a real ChatGPT → Ci MCP read call.
5. Verify a policy-safe write flow only on a ChatGPT plan/workspace surface that supports writes.

## Acceptance

Desktop Commander remains bootstrap / break-glass / recovery until the real ChatGPT Ci plugin transport successfully calls Ci and returns verified ACTUAL state.

Optional UI and canonical logo assets are deferred until the core transport is verified; no approximate logo is permitted.


## Silent entry / version reconciliation

Owner-approved \`Сі\` conversational entry is specified at
[\`operator-node/CI_UNIVERSAL_AI_BINDING.md\`, §18](../../operator-node/CI_UNIVERSAL_AI_BINDING.md#18-тихий-вхід-ci--контракт-взаємодії).

**Do not interpret this README, a skill prompt, or \`.mcp.json\` as a verified ChatGPT invocation or a live Ci role.** An actual tool handshake and server-side principal/scope checks are necessary.

**2026-10-12 source drift:** the privately installed \`ci\` plugin was read as \`0.1.18\`, whereas this repository's \`plugins/ci/.codex-plugin/plugin.json\` remains \`0.1.0\`. These are different snapshots. Never blindly reinstall the older package or overwrite installed skills with it; compare source, reconcile deliberately, and update the existing plugin identity only after separate authorization.

**Shortest safe path to an operational binding:**

1. Keep the existing Ci MCP endpoint and single identity; identify the real registered ChatGPT app ID **if it exists** (do not fabricate, create duplicates, or claim a prior connection is current).
2. Check current app availability and real OAuth/MCP tools on the target ChatGPT surface. Official app selection / @mention may be required on some surfaces; \`Сі\` alone cannot be promised to invoke tools globally until tested.
3. Before changing manifests or a plugin release, reconcile installed \`0.1.18\` against the repository package to avoid downgrade.
4. Establish a read-only live handshake: correct Ci node, authenticated principal/role, permitted scope, requested callable tool; keep secrets out of logs, PRs, and chat.
5. Verify both (a) silent greeting behavior and (b) **actual** Ci resource read, in separate test scenarios. Check web and mobile separately.
6. Require a separate owner decision for real app connection changes, role expansions, plugin release, merge, or production rollout. No background polling or replacement control plane.

**Current scope of PR #102:** specification only. The installed private \`ci\` plugin, registered app, OAuth policies, Orange runtime, and production resources remain unchanged. The technical binding is **not** accepted merely because this PR exists.

