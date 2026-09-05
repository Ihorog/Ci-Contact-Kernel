# Ci+ GPT / MCP Connector

## Purpose

`/mcp/ci` is the remote MCP adapter for the Ci+ control plane.

MCP is not a second control authority. ChatGPT or another MCP client can discover and invoke a compact Ci+ surface, while permission, risk, approval, execution, evidence, and verification remain server-side in Ci+.

Production endpoint:

```text
https://ciplus.cimeika.com.ua/mcp/ci
```

Transport: stateless MCP Streamable HTTP over POST.

Supported protocol revisions:

- `2025-06-18`
- `2025-03-26`

GET does not open an SSE stream and returns `405`. DELETE returns `405` because this adapter does not allocate MCP sessions.

## Tool surface

### Read-only — available by default

| Tool | Ci+ route | Effect |
|---|---|---|
| `ci_status` | `GET /ci/status` | Current control-plane/runtime status |
| `ci_state` | `GET /ci/task/:id` or `GET /ci/tasks` | Task or recent state |
| `ci_verify` | `GET /ci/task/:id` | Verification/evidence projection only |

### Write — fail-closed and opt-in

| Tool | Ci+ route | Effect |
|---|---|---|
| `ci_resolve` | `POST /ci/signal` | Creates Ci+ state for classification/routing |
| `ci_execute` | `POST /ci/task/:id/run` | Requests execution of an existing Ci+ task |

Write tools are advertised only when both conditions are true:

1. `CI_MCP_WRITE_ENABLED=true`
2. request `Authorization: Bearer <CI_MCP_TOKEN>` matches the configured server secret

Otherwise the MCP surface is read-only. Direct attempts to call write tools fail without calling the Ci+ control plane.

## Authority boundary

The adapter intentionally has no tool that approves a checkpoint or grants a permission.

`ci_execute` always sends an empty request body to `/ci/task/:id/run`. Client-supplied `permissions`, approval flags, executor authority, or risk overrides are ignored and never forwarded.

Therefore the authority chain remains:

```text
MCP client
  -> /mcp/ci
  -> Ci+ task/signal facade
  -> Ci+ policy / risk / approval
  -> authorized executor
  -> verification / evidence
```

## Runtime configuration

```text
CI_CONTROL_PLANE_URL=https://ciplus.cimeika.com.ua
CI_MCP_WRITE_ENABLED=false
CI_MCP_TOKEN=
CI_MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://chat.openai.com,https://platform.openai.com
```

`CI_MCP_WRITE_ENABLED=false` is the safe default.

`CI_MCP_TOKEN` is required only for write mode. It must be a dedicated secret and must not reuse executor credentials, the Keenetic upstream token, or another service token.

`CI_MCP_ALLOWED_ORIGINS` is a comma-separated browser Origin allowlist. Requests without an Origin header are accepted for server-to-server MCP clients.

## Deployment

### Cloudflare

`src/workerWithCiMcp.mjs` wraps the existing `src/worker.mjs`.

It intercepts only `/mcp/ci` and delegates every other route to the existing Worker unchanged. It re-exports `VodyanyiState`, preserving the existing Durable Object binding/migration.

Control-plane calls from the MCP adapter are dispatched directly to the underlying Worker in-process, avoiding a public self-request loop.

### Vercel

`src/ciMcpServer.js` is a small Express transport for `/mcp/ci`.

`vercel.json` routes `/mcp/ci` to this transport and preserves the existing `src/server.js` fallback for all other routes.

## Security invariants

1. Ci+ remains the only control authority.
2. MCP write is disabled unless explicitly enabled server-side.
3. Write additionally requires a dedicated bearer token.
4. The MCP bearer token is never forwarded to `/ci/*`.
5. The MCP client cannot grant itself Ci+ permissions.
6. The MCP client cannot approve or reject checkpoints through this adapter.
7. `ci_execute` cannot forward client permission overrides.
8. Browser Origin is allowlisted.
9. Request bodies are capped at 64 KiB.
10. Read tools are annotated read-only; execution is annotated destructive/open-world so compatible clients can apply confirmation UX.

## Acceptance contract

Automated tests verify:

- MCP initialization and protocol negotiation;
- read-only default tool discovery;
- dual write gate (server flag + bearer token);
- status/state/verification route mapping;
- direct unauthorized write calls fail without upstream calls;
- client permission escalation is stripped from `ci_execute`;
- unexpected browser origins are rejected.

## ChatGPT activation state

The server endpoint and client-plan availability are separate facts.

Do not mark ChatGPT write integration as active until:

1. `/mcp/ci` is deployed and live-tested;
2. the target ChatGPT account/workspace exposes custom MCP/developer-mode connection capability appropriate to the requested operations;
3. the connector passes live `initialize`, `tools/list`, a read call, and the intended authorized write/confirmation flow.
