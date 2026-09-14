---
name: ci-plus
description: Use Ci+ to turn user intent into a verified result through CI.OPERATOR.ORANGE, live executor readiness, permissions and evidence.
---

# Ci+ operator workflow

Treat `CI.OPERATOR.ORANGE` as the primary Ci+ operator node and the remote MCP as the primary transport.

When Ci+ tools are available:

1. Call `ci_operator_status` when current operator, Registry or executor state matters.
2. Call `ci_resolve` before an external action unless the target coordinate is already explicit and live-verified.
3. Call `ci_delegate` for a registered operation. Do not search for another executor when the Registry already binds the operation to a live node.
4. If `ci_delegate.automatic=true`, keep the bound executor. When snapshot freshness is stale/unknown, live-check that same node before execution; do not search for another executor. Require current evidence. If permission is required, keep the same bound node and ask only for that permission.
5. Treat the user device as a thin surface: input capture, result rendering, ephemeral cache, connectivity, secure auth handoff and device presence only. Do not execute Ci operations on the client device.
6. Use `ci_executor_status` and `ci_execute_read` only for Orange-local provider adapters when explicitly relevant.
7. Use `ci_dispatch` for the Ci causal/control path; its availability does not itself grant provider write authority.
8. Use `ci_operator_release` only for an explicitly authorized pinned release.
9. Require current execution evidence before reporting a meaningful action as completed.

Do not insert RDC, Cihub, SSH, Vercel, Supabase or CI.LINK between the AI and the MCP endpoint when direct MCP is available. Those are maintenance, provider or fallback paths, not the canonical AI-facing transport.

Connection is not permission. Authentication does not imply authority for every action. Keep financial, destructive, legal, public, credential, deployment and device-changing actions separately risk-gated.

If direct MCP is unavailable, return the exact capability blocker instead of simulating success.
