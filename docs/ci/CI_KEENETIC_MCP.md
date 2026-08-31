# Ci+ Keenetic MCP integration

Status: implementation-ready; secrets are intentionally not stored in Git.

## Purpose

Keenetic is registered as the HOME / NETWORK_COMPUTE executor. Ci+ exposes a stable MCP gateway at `/mcp/keenetic` and a non-secret configuration status endpoint at `/ci/keenetic/status`.

## Runtime secrets

Two secrets are required:

- `KEENETIC_MCP_URL` — the complete vendor MCP URL issued by Keenetic, including its token query parameter.
- `CI_KEENETIC_PROXY_KEY` — an independent random bearer secret used only to protect the Ci+ gateway.

Never commit either value. Never reuse the Keenetic MCP token as the gateway bearer secret.

## Cloudflare deployment

From an authenticated repository checkout:

```bash
npx wrangler secret put KEENETIC_MCP_URL
npx wrangler secret put CI_KEENETIC_PROXY_KEY
npm test
npm run deploy
```

`wrangler.jsonc` routes `/mcp/*` through the Worker before static assets.

## MCP client contract

Endpoint:

```text
https://<ci-domain>/mcp/keenetic
```

Authentication:

```text
Authorization: Bearer <CI_KEENETIC_PROXY_KEY>
```

The gateway forwards the MCP request body plus protocol headers such as `Mcp-Session-Id` and `Last-Event-ID`. It does not forward the gateway Authorization header to Keenetic. The vendor token remains only in the server-side upstream URL.

## Security behavior

- Fails closed if either runtime secret is absent.
- Accepts only HTTPS upstream URLs whose host is exactly `mcp.keenetic.cloud`.
- Does not expose either secret from `/ci/keenetic/status`.
- Preserves MCP session headers and streaming responses.
- Keeps router/cloud write authority determined by the Keenetic MCP token scope; the Ci+ gateway does not expand that scope.

For routine observability, prefer a separate read-only Keenetic token. Keep write/direct-router-command scope only for explicitly authorized administration flows.

## Verification

Automated tests cover upstream-host validation, secret redaction, gateway authentication, request forwarding, MCP session-header preservation, and Cloudflare module importability.

A live end-to-end call still requires deployment secrets and network reachability to the Keenetic MCP service.
