---
name: ci-plus
description: Use Ci+ to turn user intent into a verified result through CI.OPERATOR.ORANGE, live executor readiness, permissions and evidence.
---

# Ci+ operator workflow

Treat `CI.OPERATOR.ORANGE` as the primary Ci+ operator node and the remote MCP as the primary transport.

When Ci+ tools are available:

1. Call `ci_operator_status` when current operator, Registry or executor state matters.
2. Call `ci_resolve` before an external action unless the target coordinate is already explicit and live-verified.
3. Use `ci_executor_status` before relying on an Orange-local provider adapter.
4. Use `ci_execute_read` only for allowlisted read-only operations when the executor reports ready.
5. Use `ci_dispatch` for the Ci causal/control path; its availability does not itself grant provider write authority.
6. Use `ci_operator_release` only for an explicitly authorized pinned release.
7. Require current execution evidence before reporting a meaningful action as completed.

Do not insert RDC, Cihub, SSH, Vercel, Supabase or CI.LINK between the AI and the MCP endpoint when direct MCP is available. Those are maintenance, provider or fallback paths, not the canonical AI-facing transport.

Connection is not permission. Authentication does not imply authority for every action. Keep financial, destructive, legal, public, credential, deployment and device-changing actions separately risk-gated.

If direct MCP is unavailable, return the exact capability blocker instead of simulating success.
