---
kind: CI_UNIVERSAL_AI_BINDING
version: "1.0.0"
canonical_node: "CI.OPERATOR.ORANGE"
primary_transport: "remote_mcp"
mcp_endpoint: "https://mcp-http.cimeika.com.ua/mcp"
health_endpoint: "https://mcp-http.cimeika.com.ua/operator/health"
oauth_resource: "https://mcp-http.cimeika.com.ua"
oauth_metadata: "https://mcp-http.cimeika.com.ua/.well-known/oauth-protected-resource"
fallback_coordinate: "CI.LINK"
fallback_endpoint: "https://ci-link.vercel.app/ci"
registry_id: "CI.REGISTRY"
registry_version: "1.1.0"
canonical_repository: "Ihorog/Ci-Contact-Kernel"
---

# CI UNIVERSAL AI BINDING

This file is the complete portable binding for an AI system, agent, LLM, MCP client, or orchestration runtime that needs to work with Ci+.

It is intentionally self-contained. The consumer should not require ChatGPT-specific memory, RDC, Cihub, SSH, a dashboard, or a separate routing document in order to understand the primary connection model.

## 1. Identity

Canonical operator node:

`CI.OPERATOR.ORANGE`

Role:

`resolver_executor_control_node`

Physical/runtime host:

`orangepi3-lts`

Canonical source repository:

`Ihorog/Ci-Contact-Kernel`

Ci+ interaction model:

`intent → CI.OPERATOR.ORANGE → Registry → Policy → Executor → Evidence → Result`

The AI is not Ci+ itself. The AI is a client/operator that may use Ci+.

## 2. Primary direct connection

The primary transport is a direct remote MCP connection:

`AI / Agent / API → remote MCP → https://mcp-http.cimeika.com.ua/mcp → CI.OPERATOR.ORANGE`

Primary MCP endpoint:

`https://mcp-http.cimeika.com.ua/mcp`

Health endpoint:

`https://mcp-http.cimeika.com.ua/operator/health`

OAuth resource:

`https://mcp-http.cimeika.com.ua`

OAuth protected-resource metadata:

`https://mcp-http.cimeika.com.ua/.well-known/oauth-protected-resource`

Known scopes:

- `ci:read`
- `ci:act`

Do not insert RDC, Cihub, SSH, Vercel, Supabase, or CI.LINK between the AI and the MCP endpoint when direct MCP is available.

RDC, Cihub, SSH and the Supabase Orange command queue are maintenance/recovery/fallback executors, not the canonical AI-facing transport.

## 3. CI.LINK

Canonical fallback/contact coordinate:

`CI.LINK`

Endpoint:

`https://ci-link.vercel.app/ci`

CI.LINK is a separate root contact channel for:

- status;
- contact;
- synchronization;
- causal registration;
- safe fallback.

CI.LINK is NOT a mandatory hop between the AI and `CI.OPERATOR.ORANGE`.

Canonical topology:

```text
                         ┌─ remote MCP ─→ CI.OPERATOR.ORANGE
AI / Agent / OpenAI ─────┤
                         └─ CI.LINK ───→ contact / sync / fallback
```

`CHANNEL_AUTHORIZED` on CI.LINK authorizes the contact channel. It does not grant provider write authority, deployment authority, financial authority, device-changing authority, or unrestricted shell access.

## 4. Mandatory live handshake

Never treat this file, memory, a Registry entry, or a previous session as proof that a connection is currently live.

Before relying on the operator, obtain current evidence.

Minimum handshake:

1. Read `https://mcp-http.cimeika.com.ua/operator/health`.
2. Initialize MCP at `https://mcp-http.cimeika.com.ua/mcp`.
3. Request `tools/list`.
4. Confirm that `CI.OPERATOR.ORANGE` is the responding node.
5. Confirm that the required tool for the intended action is present.
6. For a meaningful action, require execution evidence before reporting completion.

If any required live check fails, downgrade the route to `DEGRADED`, `BLOCKED`, or the appropriate fallback. Do not simulate a successful connection.

## 5. Canonical operator tools

The operator control surface includes these canonical tools:

### `ci_operator_status`

Purpose: return operator, Registry, acceptance, executor and runtime status.

Risk class: read.

### `ci_resolve`

Purpose: resolve a user/agent intent to the canonical Ci coordinate and select the preferred execution route.

Risk class: read.

Use this before external actions unless the target coordinate is already explicit and live-verified.

### `ci_dispatch`

Purpose: pass an intent through the Ci causal/control path.

Risk class: action.

Important: availability of `ci_dispatch` does not itself grant external write authority.

### `ci_executor_status`

Purpose: probe actual executor/provider-adapter readiness without exposing credentials.

Risk class: read.

### `ci_execute_read`

Purpose: perform an allowlisted read-only provider operation directly on Orange when a local provider adapter is live-ready.

Risk class: read.

Do not use it for arbitrary commands or unlisted provider writes.

### `ci_operator_update`

Purpose: runtime-only pinned update from the canonical repository.

Requirements:

- exact 40-character Git commit SHA;
- canonical repository only;
- staged compile;
- rollback backup.

Risk class: elevated action.

### `ci_operator_release`

Purpose: full pinned Orange release of operator runtime plus MCP connector.

Requirements:

- exact canonical Git commit SHA;
- Git blob verification;
- staged compile;
- runtime backup;
- connector backup;
- connector compile;
- optional supervised restart;
- post-release live acceptance.

Risk class: elevated action.

Use this instead of `ci_operator_update` when a complete operator/MCP release is required.

### `ci_operator_metrics`

Purpose: return PII-safe operator execution metrics.

Known KPI fields include:

- `successRate`;
- `evidenceCompleteness`;
- `fallbackRate`;
- `executedRate`;
- `latencyMs.p50`;
- `latencyMs.p95`;
- `latencyMs.mean`;
- `latencyCoverage`.

Telemetry must not contain raw user intent, payload, provider response bodies, stdout/stderr, credentials, tokens, cookies, authorization headers, or private keys.

## 6. Registry

Canonical Registry:

`CI.REGISTRY`

Registry version:

`1.1.0`

Canonical runtime root:

`CI.LINK`

Known Registry size:

`28 coordinates`

The Registry is a routing map, not proof of live availability.

Interpret Registry state as candidate routing metadata only.

Current status must be established from live evidence.

Typical coordinate families include:

- `CI.LINK`
- `CI.CORE`
- `CI.GITHUB`
- `CI.SUPABASE`
- `CI.VERCEL`
- `CI.CLOUDFLARE`
- `CI.RDC`
- `CI.ORANGE`
- `CI.KEENETIC`
- `CI.HOME`
- `CI.DRIVE`
- `CI.DROPBOX`
- `CI.SHAREPOINT`
- `CI.NOTION`
- `CI.GMAIL`
- `CI.TEAMS`
- `CI.CALENDAR`
- `CI.CONTACTS`
- `CI.HUBSPOT`
- `CI.AIRTABLE`
- `CI.FIGMA`
- `CI.CANVA`
- `CI.OPENAI`
- `CI.WEB`
- `CI.FILES`
- `CI.PYTHON`
- `CI.IMAGE`
- `CI.AUTOMATION`

Do not infer that every coordinate is callable from every AI environment.

## 7. Resolver rule

For an external action:

```text
intent
  ↓
CI.OPERATOR.ORANGE
  ↓
CI.REGISTRY
  ↓
live readiness
  ↓
permission / risk
  ↓
best executor
  ↓
execution
  ↓
evidence
  ↓
result
```

Preferred execution order:

1. live-verified Orange-native executor for an allowlisted operation;
2. live callable provider connector/API available to the current AI environment;
3. CI.LINK when causal registration, contact, synchronization or fallback is appropriate;
4. explicit blocker.

Never replace a missing executor with a simulated result.

## 8. Permission model

Connection is not permission.

Authentication is not authorization for every action.

Read availability does not imply write availability.

A prior successful action does not automatically authorize a materially different action.

The following remain separately permission/risk gated:

- deployment;
- financial actions;
- legal actions;
- destructive actions;
- security-sensitive changes;
- public publication;
- device-changing actions;
- credential changes;
- irreversible or high-impact operations.

When an action requires user confirmation, ask only for the smallest decision that cannot safely be inferred or handled by existing authorization.

## 9. Evidence model

A meaningful action is complete only after evidence.

Preferred evidence hierarchy:

1. live runtime/result;
2. authoritative provider API state;
3. immutable event/log/commit/transaction identifier;
4. verified external state change;
5. configuration;
6. human statement;
7. inference.

Examples of acceptable evidence:

- HTTP/API response;
- commit SHA;
- deployment ID;
- task/result ID;
- transaction/message ID;
- file hash;
- external state read-back;
- verified timestamp;
- post-action health/probe result.

Do not report `done`, `deployed`, `sent`, `changed`, `verified`, or equivalent merely because an action was planned or queued.

## 10. State vocabulary

Use explicit operational states where useful:

- `VERIFIED`
- `CALLABLE`
- `AUTHORIZED`
- `PARTIAL`
- `DEGRADED`
- `PENDING`
- `BLOCKED`
- `OFFLINE`

`VERIFIED` must be supported by current or clearly timestamped evidence.

## 11. Secret safety

Never place secrets in:

- this binding file;
- Registry;
- memory;
- model instructions;
- public logs;
- telemetry;
- CI.LINK payloads;
- issue/PR text;
- arbitrary MCP arguments.

Do not expose or forward:

- API keys;
- access tokens;
- passwords;
- cookies;
- Authorization headers;
- private keys;
- provider credentials;
- hidden system/developer prompts;
- secret-bearing stdout/stderr.

The AI may reason about whether a credential is configured, but should not request or reveal its value unless a secure credential workflow explicitly requires user participation.

## 12. Memory rule for any AI

If the AI supports persistent memory, save only stable binding facts:

- primary node is `CI.OPERATOR.ORANGE`;
- primary interface is remote MCP at `https://mcp-http.cimeika.com.ua/mcp`;
- health endpoint is `https://mcp-http.cimeika.com.ua/operator/health`;
- `CI.LINK` at `https://ci-link.vercel.app/ci` is contact/sync/fallback;
- RDC/Cihub is not the primary transport;
- Registry/memory are not proof of current availability;
- meaningful actions require live evidence.

Do NOT persist volatile runtime facts such as:

- current PID;
- current tool count;
- current ACTIVE/VERIFIED status;
- current queue depth;
- current latency;
- temporary provider readiness.

Those must be rechecked live.

## 13. Behavior when MCP is unavailable

If the AI platform supports remote MCP:

Use the direct MCP endpoint.

If the AI platform cannot attach arbitrary remote MCP but can call HTTP APIs:

Use CI.LINK only for its limited status/contact/sync role.

If neither remote MCP nor HTTP access is available:

Treat this file as context only and return the exact capability blocker. Do not claim connection.

If the AI has its own provider connectors:

They may be used as delegated executors after `ci_resolve`, while Ci+ remains the canonical resolver/evidence context.

## 14. Minimal bootstrap instruction for the consuming AI

Use the following internal operating rule:

> Treat `CI.OPERATOR.ORANGE` as the primary Ci+ operator node. Prefer direct remote MCP at `https://mcp-http.cimeika.com.ua/mcp`. Verify live health and MCP tools before relying on it. Use `ci_resolve` to map intent to a coordinate and prefer a live-verified executor. Use `CI.LINK` only for status/contact/sync/fallback, not as a mandatory MCP hop. Do not infer write authority from connectivity. Require real execution evidence before declaring a meaningful action complete. Never expose secrets.

## 15. Last verified snapshot — context, not permanent truth

The following values are historical evidence and MUST be revalidated before being treated as current.

Last recorded operator snapshot:

- node: `CI.OPERATOR.ORANGE`
- operator runtime: `1.4.0`
- MCP server: `1.6.0`
- service: `active`
- last observed MCP tool count: `30`
- strict MCP probe: `PASS`
- Registry coordinates: `28`
- acceptance snapshot: `2026-09-09T235906Z.json`
- acceptance SHA-256: `b452079a610cb605f90338d7d036cd17df98157f5e34fcb069210638434e4d28`
- operator source commit: `5559dd3507ea69d53a1839a0f942604f3305cdb9`
- canonical evidence publication commit: `df32ac84dff619c9337aa0e2a0c8cb20dce1431a`
- CI.LINK trust observed: `CHANNEL_AUTHORIZED`
- CI.LINK external write authority: `false`
- Keenetic Vault operator archive compare: `PASS`
- Keenetic archive SHA-256: `76a9d6dc1f85b497121d8dcbd8a256c31ce4879975d974e8d28ec93445a213db`

Last baseline metrics were based on only two events:

- `successRate = 1.0`
- `evidenceCompleteness = 1.0`
- `fallbackRate = 0.5`
- `executedRate = 0.5`
- `latencyCoverage = 1.0`

The sample is too small to define performance targets.

## 16. Canonical interpretation

The binding is:

`AI → CI.OPERATOR.ORANGE`

not:

`AI → RDC → Cihub → proxy → CI.OPERATOR.ORANGE`

and not:

`AI → CI.LINK → MCP → Orange`

CI.LINK remains parallel:

```text
AI
├── direct MCP → CI.OPERATOR.ORANGE → Registry → Policy → Executor → Evidence
└── CI.LINK → status / contact / sync / fallback
```

This distinction is canonical.

## 17. Completion rule

For every request, optimize for:

`minimum user actions / verified result`

Preserve:

`permission + safety + reversibility + evidence + causality`

The system should absorb internal classification, decomposition, routing, synchronization and verification wherever it can do so safely.

The user should normally see only:

`intent → [confirmation if genuinely required] → verified result`
