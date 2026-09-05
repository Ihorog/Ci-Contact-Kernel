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
