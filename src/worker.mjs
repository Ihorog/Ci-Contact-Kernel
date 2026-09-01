import { keeneticWorkerStatus, proxyKeeneticWorker } from "./keeneticWorkerGateway.mjs";

const TASK_INDEX_KEY = "ci_tasks:__index";
const TASK_KEY_PREFIX = "ci_task:";
const MAX_TASKS = 200;
const TASK_TTL_SECONDS = 60 * 60 * 24 * 7;

const tasks = new Map();

const CLASSIFICATIONS = new Set([
  "fact",
  "intent",
  "task",
  "event",
  "memory",
  "service_action",
  "device_action",
  "repo_action",
  "deploy_action",
  "human_action",
  "unknown",
]);

const ROUTES = {
  fact: { targetNode: "ci.memory.node", executionCenter: "memory" },
  memory: { targetNode: "ci.memory.node", executionCenter: "memory" },
  repo_action: { targetNode: "ci.repo.node", executionCenter: "repo" },
  service_action: { targetNode: "ci.service.node", executionCenter: "service" },
  device_action: { targetNode: "ci.device.node", executionCenter: "device" },
  deploy_action: { targetNode: "ci.device.node", executionCenter: "device" },
  human_action: { targetNode: "ci.human.node", executionCenter: "human" },
  intent: { targetNode: "ci.ai.node", executionCenter: "ai" },
  task: { targetNode: "ci.ai.node", executionCenter: "ai" },
  event: { targetNode: "ci.local.node", executionCenter: "local" },
  unknown: { targetNode: "ci.unknown.node", executionCenter: "local" },
};

const PERMISSION_LEVELS = {
  deploy_action: "L5_DEPLOY_OR_DEVICE_ACTION",
  device_action: "L5_DEPLOY_OR_DEVICE_ACTION",
  service_action: "L4_EXTERNAL_API_WRITE",
  repo_action: "L3_REPO_WRITE",
  human_action: "L2_LOCAL_WRITE",
  task: "L1_DRAFT",
};

const ELEVATED_PERMISSIONS = {
  L2_LOCAL_WRITE: {
    key: "localWrite",
    missing: "Missing explicit local workspace permission.",
    allowed: "Explicit local workspace permission granted.",
  },
  L3_REPO_WRITE: {
    key: "repoWrite",
    missing: "Missing explicit repository delegation.",
    allowed: "Explicit repository delegation granted.",
  },
  L4_EXTERNAL_API_WRITE: {
    key: "externalApiWrite",
    missing: "Missing explicit external service/API permission.",
    allowed: "Explicit external API permission granted.",
  },
  L5_DEPLOY_OR_DEVICE_ACTION: {
    key: "deployOrDeviceConfirm",
    missing: "Missing explicit deploy/device confirmation.",
    allowed: "Explicit deploy/device confirmation granted.",
  },
};

const SENSITIVE_CENTERS = new Set(["ai", "service", "repo", "device", "human"]);

function apiHeaders(extra = {}) {
  return {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...extra,
  };
}

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: apiHeaders(extraHeaders),
  });
}

function methodNotAllowed(allowed) {
  return json(
    { error: "Method not allowed" },
    405,
    { allow: allowed },
  );
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 65_536) {
    throw Object.assign(new Error("Request body is too large"), { status: 413 });
  }

  const raw = await request.text();
  if (raw.length > 65_536) {
    throw Object.assign(new Error("Request body is too large"), { status: 413 });
  }
  if (!raw) return {};

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { status: 400 });
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("Request body must be a JSON object"), { status: 400 });
  }
  return parsed;
}

function signalText(payload) {
  const direct = payload.message || payload.text || payload.command || "";
  let serialized = "";
  try {
    serialized = JSON.stringify(payload);
  } catch {
    serialized = "";
  }
  return `${direct} ${serialized}`.toLowerCase();
}

function classify(payload) {
  const direct = String(payload.classification || payload.type || "").toLowerCase();
  if (CLASSIFICATIONS.has(direct)) return direct;

  const text = signalText(payload);
  if (/\b(deploy|deployment|release)\b|депло|розгорн|реліз/.test(text)) return "deploy_action";
  if (/\b(repo|repository|branch|commit|pull request|git push|github)\b|репозитор|гілк|коміт|пуш/.test(text)) return "repo_action";
  if (/\b(device|hardware|sensor|camera)\b|пристр|обладнан|сенсор|камер/.test(text)) return "device_action";
  if (/\b(service action|external api|call api|webhook post|supabase|vercel)\b|сервіс|вебхук|апі/.test(text)) return "service_action";
  if (/\b(human|approve|review)\b|людин|погоджен|схвал/.test(text)) return "human_action";
  if (/\b(remember|memory|recall)\b|пам['’]?ят|запам/.test(text)) return "memory";
  if (/\b(event|trigger|webhook)\b|поді|тригер/.test(text) || payload.event) return "event";
  if (/\b(task|todo|implement|build|run)\b|задач|завдан|реаліз|побуд|запуст/.test(text)) return "task";
  if (/\b(intent|want|need|goal|plan)\b|хочу|потріб|мета|план/.test(text)) return "intent";
  if (payload.fact === true || /\b(fact|status|state)\b|факт|статус|стан/.test(text)) return "fact";
  return "unknown";
}

function permissionFor(classification, payload) {
  const level = payload.permissionLevel || PERMISSION_LEVELS[classification] || "L0_READ";
  if (level === "L0_READ" || level === "L1_DRAFT") {
    return {
      level,
      allowed: true,
      decision: "ALLOWED: Low-risk permission level.",
    };
  }

  const requirement = ELEVATED_PERMISSIONS[level];
  if (!requirement) {
    return {
      level,
      allowed: false,
      decision: "BLOCKED: Unknown permission level.",
    };
  }

  const allowed = payload.permissions?.[requirement.key] === true;
  return {
    level,
    allowed,
    decision: `${allowed ? "ALLOWED" : "BLOCKED"}: ${allowed ? requirement.allowed : requirement.missing}`,
  };
}

function cacheTask(task) {
  tasks.set(task.id, task);
  if (tasks.size <= MAX_TASKS) return;
  const oldest = [...tasks.values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, tasks.size - MAX_TASKS);
  for (const item of oldest) tasks.delete(item.id);
}

function kvBinding(env) {
  const binding = env?.CI_MEMORY_KV;
  return binding && typeof binding.get === "function" && typeof binding.put === "function"
    ? binding
    : null;
}

async function readIndex(kv) {
  const raw = await kv.get(TASK_INDEX_KEY, { type: "json" });
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function persistTask(task, env) {
  cacheTask(task);
  const kv = kvBinding(env);
  if (!kv) return false;

  try {
    await kv.put(`${TASK_KEY_PREFIX}${task.id}`, JSON.stringify(task), {
      expirationTtl: TASK_TTL_SECONDS,
    });
    const current = await readIndex(kv);
    const next = [task.id, ...current.filter((id) => id !== task.id)].slice(0, MAX_TASKS);
    await kv.put(TASK_INDEX_KEY, JSON.stringify(next));
    return true;
  } catch (error) {
    console.warn("Ci task persistence failed", error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function loadTask(id, env) {
  const cached = tasks.get(id);
  if (cached) return cached;

  const kv = kvBinding(env);
  if (!kv) return null;
  try {
    const task = await kv.get(`${TASK_KEY_PREFIX}${id}`, { type: "json" });
    if (task && typeof task === "object") {
      cacheTask(task);
      return task;
    }
  } catch (error) {
    console.warn("Ci task read failed", error instanceof Error ? error.message : String(error));
  }
  return null;
}

async function recentTasks(env, limit = 50) {
  const bounded = Math.min(Math.max(1, Number(limit) || 50), MAX_TASKS);
  const byId = new Map([...tasks.values()].map((task) => [task.id, task]));
  const kv = kvBinding(env);

  if (kv) {
    try {
      const ids = (await readIndex(kv)).slice(0, bounded);
      const remote = await Promise.all(ids.map((id) => loadTask(id, env)));
      for (const task of remote.filter(Boolean)) byId.set(task.id, task);
    } catch (error) {
      console.warn("Ci task index read failed", error instanceof Error ? error.message : String(error));
    }
  }

  return [...byId.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, bounded);
}

function execute(payload, source) {
  const timestamp = new Date().toISOString();
  const classification = classify(payload);
  const route = ROUTES[classification] || ROUTES.unknown;
  const permission = permissionFor(classification, payload);
  const sensitive = SENSITIVE_CENTERS.has(route.executionCenter);
  const completed = permission.allowed && !sensitive;

  let result;
  let verification;
  let nextSuggestedAction;

  if (!permission.allowed) {
    result = { outcome: "blocked", message: "Execution prevented by permission gate." };
    verification = { status: "blocked", method: "manual_confirmation_required" };
    nextSuggestedAction = "Provide the required explicit permission and create a new task.";
  } else if (sensitive) {
    result = {
      outcome: "stub",
      message: `Execution center '${route.executionCenter}' is connected as a safe stub; no external write was performed.`,
    };
    verification = { status: "blocked", method: "safe_stub" };
    nextSuggestedAction = "Delegate execution to an authorized service and verify its result.";
  } else {
    result = {
      outcome: "ok",
      message: route.executionCenter === "memory"
        ? "Signal classified and recorded by the memory route."
        : "Signal classified and handled by the local route.",
    };
    verification = { status: "verified", method: "direct_result" };
    nextSuggestedAction = "Send the next signal.";
  }

  return {
    id: crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    source: payload.source || source,
    signalId: payload.signalId || null,
    type: payload.type || "signal",
    priority: payload.priority || "normal",
    status: completed ? "COMPLETED" : "BLOCKED",
    classification,
    targetNode: route.targetNode,
    executionCenter: route.executionCenter,
    executionCenters: [route.executionCenter],
    requestedAction: payload.requestedAction || payload.action || null,
    permissionLevel: permission.level,
    permissionDecision: permission.decision,
    approvalPolicy: payload.approvalPolicy || null,
    approvalState: sensitive ? "required" : null,
    checkpointId: null,
    payload,
    result,
    verification,
    completionPolicy: payload.completionPolicy || "all_verifiers",
    requiredVerifiers: payload.requiredVerifiers || ["result_outcome"],
    verificationResults: completed
      ? [{ verifierId: "result_outcome", status: "pass", timestamp, evidence: { outcome: "ok" } }]
      : [],
    verificationAttempt: completed ? 1 : 0,
    maxVerificationRetries: Number.isFinite(payload.maxVerificationRetries)
      ? payload.maxVerificationRetries
      : 2,
    incidentRecord: null,
    aggregationPolicy: payload.aggregationPolicy || "all_required",
    aggregationSummary: null,
    branches: [],
    error: null,
    nextSuggestedAction,
  };
}

function memoryRecord(task) {
  return {
    timestamp: task.updatedAt,
    taskId: task.id,
    signal: task.payload,
    classification: task.classification,
    node: task.targetNode,
    executionCenter: task.executionCenter,
    permissionDecision: task.permissionDecision,
    statusAfter: task.status,
    result: task.result,
    verification: task.verification,
    nextSuggestedAction: task.nextSuggestedAction,
  };
}

function detectContext(signal = {}) {
  const repoFields = [
    signal.repo,
    signal.repository,
    signal.repositoryName,
    signal.context?.repo,
    signal.context?.repository,
  ].filter(Boolean);
  return {
    source: signal.source || signal.origin || "unknown",
    detectedNode: repoFields.length > 0 ? "repo_context" : "generic_context",
  };
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: apiHeaders() });
  }

  if (pathname === "/ci/status") {
    if (request.method !== "GET") return methodNotAllowed("GET, OPTIONS");
    const kv = kvBinding(env);
    let taskCount = tasks.size;
    if (kv) {
      try {
        taskCount = Math.max(taskCount, (await readIndex(kv)).length);
      } catch {
        // The health response remains available if optional storage is temporarily unavailable.
      }
    }
    return json({
      status: "ok",
      runtime: "cloudflare-workers",
      workerActive: true,
      queueDepth: 0,
      activeTaskId: null,
      taskCount,
      storage: kv ? "cloudflare-kv" : "isolate-memory",
      durableStorage: Boolean(kv),
      knownModules: ["classifier", "router", "permission-gate", "verification", "keenetic-mcp"],
      timestamp: new Date().toISOString(),
    });
  }

  if (pathname === "/ci/keenetic/status") {
    if (request.method !== "GET") return methodNotAllowed("GET, OPTIONS");
    return json(keeneticWorkerStatus(env));
  }

  if (pathname === "/ci/signal" || pathname === "/ci/task" || pathname === "/ci/command") {
    if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
    const payload = await readJson(request);
    const source = pathname === "/ci/signal" ? "signal" : pathname === "/ci/task" ? "task" : "ci.command";
    const normalized = pathname === "/ci/command"
      ? { ...payload, type: "command", command: payload.command || null }
      : pathname === "/ci/task"
        ? { ...payload, type: payload.type || "task" }
        : { ...payload, type: payload.type || "signal" };
    const task = execute(normalized, source);
    await persistTask(task, env);
    return json({ task }, pathname === "/ci/task" ? 201 : 202);
  }

  if (pathname === "/ci/tasks") {
    if (request.method !== "GET") return methodNotAllowed("GET, OPTIONS");
    const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit")) || 50), MAX_TASKS);
    return json({ tasks: await recentTasks(env, limit) });
  }

  if (pathname === "/ci/memory") {
    if (request.method !== "GET") return methodNotAllowed("GET, OPTIONS");
    const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit")) || 100), MAX_TASKS);
    const records = (await recentTasks(env, limit)).map(memoryRecord);
    return json({ records });
  }

  if (pathname === "/ci/monitor") {
    if (request.method !== "GET") return methodNotAllowed("GET, OPTIONS");
    return Response.redirect(new URL("/ci-monitor.html", request.url), 302);
  }

  const runMatch = pathname.match(/^\/ci\/task\/([^/]+)\/run$/);
  if (runMatch) {
    if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
    const task = await loadTask(decodeURIComponent(runMatch[1]), env);
    if (!task) return json({ error: "Task not found" }, 404);
    return json({ task });
  }

  const taskMatch = pathname.match(/^\/ci\/task\/([^/]+)$/);
  if (taskMatch) {
    if (request.method !== "GET") return methodNotAllowed("GET, OPTIONS");
    const task = await loadTask(decodeURIComponent(taskMatch[1]), env);
    if (!task) return json({ error: "Task not found" }, 404);
    return json({ task });
  }

  if (pathname === "/ciopen/webhook") {
    if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
    const payload = await readJson(request);
    const context = detectContext(payload);
    const task = execute({ ...payload, type: "webhook", context }, "ciopen.webhook");
    await persistTask(task, env);
    return json({ context, task }, 202);
  }

  return json({ error: "Ci API route not found" }, 404);
}

async function proxyCigrafin(request, env) {
  const base = env?.CIGRAFIN_NODE_BASE_URL;
  if (!base) {
    return json({
      error: "Cigrafin routes require node-server routing",
      hint: "Set CIGRAFIN_NODE_BASE_URL so /cigrafin/* is forwarded to the Node server.",
    }, 503);
  }
  const upstreamUrl = new URL(new URL(request.url).pathname + new URL(request.url).search, base);
  const response = await fetch(upstreamUrl.toString(), request);
  return response;
}

export default {
  async fetch(request, env = {}) {
    const pathname = new URL(request.url).pathname;

    if (pathname === "/mcp/keenetic" || pathname === "/mcp/keenetic/") {
      return proxyKeeneticWorker(request, env);
    }

    if (pathname === "/cigrafin" || pathname.startsWith("/cigrafin/")) {
      try {
        return await proxyCigrafin(request, env);
      } catch (error) {
        return json({ error: "Cigrafin proxy failed" }, 502);
      }
    }
    if (pathname.startsWith("/ci/") || pathname.startsWith("/ciopen/")) {
      try {
        return await handleApi(request, env);
      } catch (error) {
        const status = Number(error?.status) || 500;
        const message = status >= 500 ? "Internal Worker error" : error.message;
        if (status >= 500) console.error("Ci Worker request failed", error);
        return json({ error: message }, status);
      }
    }

    if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};