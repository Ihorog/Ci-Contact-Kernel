import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/worker.mjs";

function makeKv() {
  const values = new Map();
  return {
    async get(key, options = {}) {
      const value = values.get(key);
      if (value === undefined) return null;
      return options.type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) {
      values.set(key, value);
    },
  };
}

function makeEnv() {
  return {
    CI_MEMORY_KV: makeKv(),
    ASSETS: {
      async fetch() {
        return new Response("asset", { status: 200 });
      },
    },
  };
}

test("GET /ci/status reports the Cloudflare runtime", async () => {
  const response = await worker.fetch(new Request("https://example.test/ci/status"), makeEnv());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.runtime, "cloudflare-workers");
  assert.equal(body.storage, "cloudflare-kv");
});

test("POST /ci/signal classifies and persists a Ukrainian status signal", async () => {
  const env = makeEnv();
  const response = await worker.fetch(new Request("https://example.test/ci/signal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Перевір стан Домівки", source: "test" }),
  }), env);
  const created = await response.json();

  assert.equal(response.status, 202);
  assert.equal(created.task.status, "COMPLETED");
  assert.equal(created.task.classification, "fact");
  assert.equal(created.task.targetNode, "ci.memory.node");
  assert.equal(created.task.verification.status, "verified");

  const fetchedResponse = await worker.fetch(
    new Request(`https://example.test/ci/task/${created.task.id}`),
    env,
  );
  const fetched = await fetchedResponse.json();
  assert.equal(fetchedResponse.status, 200);
  assert.equal(fetched.task.id, created.task.id);
});

test("elevated deployment signals are blocked without explicit permission", async () => {
  const response = await worker.fetch(new Request("https://example.test/ci/signal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Зроби deploy production" }),
  }), makeEnv());
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.task.classification, "deploy_action");
  assert.equal(body.task.status, "BLOCKED");
  assert.match(body.task.permissionDecision, /^BLOCKED:/);
});

test("non-API requests fall through to static assets", async () => {
  const response = await worker.fetch(new Request("https://example.test/"), makeEnv());
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset");
});

test("invalid JSON is rejected", async () => {
  const response = await worker.fetch(new Request("https://example.test/ci/signal", {
    method: "POST",
    body: "{invalid",
  }), makeEnv());
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, "Request body must be valid JSON");
});
