"use strict";

/**
 * Domivka Phase 1 — Express router for Semantic Home Graph (/ci/graph).
 * In-memory store seeded from cigraph/homeSeed (Phase 1 local-first).
 *
 * Mount in src/server.js inside createApp:
 *   const { createGraphApiRouter } = require("./routes/graphApi");
 *   app.use("/ci/graph", createGraphApiRouter());
 *
 * Corrections are append-only: POST /events adds a new event; callers should
 * supersede prior claims via new claim/event rows — never mutate history bodies.
 */

const express = require("express");
const { randomUUID } = require("crypto");
const {
  seedHomeRegistry,
  SEED_IDS,
  CI_ID_RE,
  getUnitNode,
  CLASS_SPACE,
} = require("../cigraph/homeSeed");

function createMemoryGraphStore() {
  const seeded = seedHomeRegistry();
  const events = [];
  return {
    nodes: seeded.nodes,
    edges: seeded.edges,
    evidence: seeded.evidence,
    events,
  };
}

function nodeToJson(n) {
  return {
    ci_id: n.ci_id,
    canonical_name: n.canonical_name,
    primary_class: n.primary_class,
    subtype: n.subtype,
    owner_scope: n.owner_scope,
    owner_domain: n.owner_domain,
    truth_status: n.truth_status,
    confidence: n.confidence,
    lifecycle_state: n.lifecycle_state,
    metadata: n.metadata,
  };
}

function buildSpacesTree(store, rootCiId) {
  const rootId = rootCiId || SEED_IDS.property;
  const root = store.nodes.get(rootId);
  if (!root) return null;

  function childrenOf(parentId) {
    const kids = [];
    for (const e of store.edges.values()) {
      if (e.relation_type === "CONTAINS" && e.from_ci_id === parentId && e.is_active !== false) {
        const child = store.nodes.get(e.to_ci_id);
        if (child && child.primary_class === CLASS_SPACE) {
          kids.push({
            ...nodeToJson(child),
            children: childrenOf(child.ci_id),
          });
        }
      }
    }
    return kids;
  }

  return { ...nodeToJson(root), children: childrenOf(root.ci_id) };
}

/**
 * @param {{ store?: object }} [options]
 */
function createGraphApiRouter(options = {}) {
  const store = options.store || createMemoryGraphStore();
  const router = express.Router();

  // GET /ci/graph/spaces/tree?root=ci_...
  router.get("/spaces/tree", (req, res) => {
    const root = typeof req.query.root === "string" ? req.query.root : SEED_IDS.property;
    if (root && !CI_ID_RE.test(root)) {
      return res.status(400).json({ error: "invalid_ci_id" });
    }
    const tree = buildSpacesTree(store, root);
    if (!tree) return res.status(404).json({ error: "root_not_found" });
    return res.json({ tree, unit_ci_id: SEED_IDS.unit });
  });

  // POST /ci/graph/spaces/tree — rebuild/refresh from seed (idempotent local helper)
  router.post("/spaces/tree", (req, res) => {
    seedHomeRegistry(store);
    const tree = buildSpacesTree(store, SEED_IDS.property);
    return res.status(200).json({ ok: true, tree });
  });

  // GET /ci/graph/nodes?class=SPACE|DEVICE&subtype=room
  router.get("/nodes", (req, res) => {
    let list = [...store.nodes.values()];
    if (req.query.class) list = list.filter((n) => n.primary_class === String(req.query.class));
    if (req.query.subtype) list = list.filter((n) => n.subtype === String(req.query.subtype));
    if (req.query.owner_domain) list = list.filter((n) => n.owner_domain === String(req.query.owner_domain));
    return res.json({ nodes: list.map(nodeToJson) });
  });

  // POST /ci/graph/nodes — register node (no secrets); refuses secret-like keys
  router.post("/nodes", (req, res) => {
    const body = req.body || {};
    const ci_id = body.ci_id;
    if (!CI_ID_RE.test(ci_id)) return res.status(400).json({ error: "invalid_ci_id" });
    if (store.nodes.has(ci_id)) return res.status(409).json({ error: "ci_id_exists" });
    const meta = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
    const banned = ["password", "wifi_key", "wifi_password", "api_key", "private_key", "token", "secret", "serial"];
    for (const k of Object.keys(meta)) {
      if (banned.includes(k.toLowerCase())) {
        return res.status(400).json({ error: "forbidden_metadata_key", key: k });
      }
    }
    const node = {
      ci_id,
      canonical_name: String(body.canonical_name || ci_id),
      primary_class: String(body.primary_class || "DEVICE"),
      subtype: body.subtype || null,
      roles: Array.isArray(body.roles) ? body.roles : [],
      scopes: Array.isArray(body.scopes) ? body.scopes : ["HOME"],
      domains: Array.isArray(body.domains) ? body.domains : [],
      owner_scope: body.owner_scope || "HOME",
      owner_domain: body.owner_domain || "HOUSING_SPACE",
      semantic_address: null,
      identity_status: "ACTIVE",
      lifecycle_state: body.lifecycle_state || "REGISTERED",
      truth_status: body.truth_status || "OBSERVED",
      confidence: typeof body.confidence === "number" ? body.confidence : 0.5,
      metadata: meta,
    };
    store.nodes.set(ci_id, node);
    return res.status(201).json({ node: nodeToJson(node) });
  });

  // GET /ci/graph/edges
  router.get("/edges", (req, res) => {
    let list = [...store.edges.values()];
    if (req.query.from) list = list.filter((e) => e.from_ci_id === String(req.query.from));
    if (req.query.to) list = list.filter((e) => e.to_ci_id === String(req.query.to));
    if (req.query.relation_type) list = list.filter((e) => e.relation_type === String(req.query.relation_type));
    return res.json({ edges: list });
  });

  // POST /ci/graph/edges
  router.post("/edges", (req, res) => {
    const body = req.body || {};
    if (!CI_ID_RE.test(body.from_ci_id) || !CI_ID_RE.test(body.to_ci_id)) {
      return res.status(400).json({ error: "invalid_ci_id" });
    }
    if (!body.relation_type) return res.status(400).json({ error: "relation_type_required" });
    const edge = {
      edge_id: body.edge_id || randomUUID(),
      from_ci_id: body.from_ci_id,
      relation_type: String(body.relation_type),
      to_ci_id: body.to_ci_id,
      truth_status: body.truth_status || "OBSERVED",
      confidence: typeof body.confidence === "number" ? body.confidence : 0.5,
      temporal_layer: body.temporal_layer || "ACTUAL",
      observed_at: body.observed_at || new Date().toISOString(),
      is_active: true,
    };
    store.edges.set(edge.edge_id, edge);
    return res.status(201).json({ edge });
  });

  // GET /ci/graph/events — append-only log
  router.get("/events", (req, res) => {
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 100), 500);
    return res.json({ events: store.events.slice(-limit) });
  });

  // POST /ci/graph/events — APPEND ONLY
  // Corrections: send a new event (and preferably a superseding claim upstream).
  // Do not UPDATE prior events; clients may set payload.supersedes_event_id.
  router.post("/events", (req, res) => {
    const body = req.body || {};
    if (!body.event_type) return res.status(400).json({ error: "event_type_required" });
    const event = {
      event_id: body.event_id || randomUUID(),
      event_type: String(body.event_type),
      actor_ci_id: body.actor_ci_id || null,
      subject_ci_id: body.subject_ci_id || null,
      target_ci_id: body.target_ci_id || null,
      occurred_at: body.occurred_at || new Date().toISOString(),
      scope: body.scope || "HOME",
      domain: body.domain || "HOUSING_SPACE",
      payload_summary: body.payload_summary || null,
      provenance_ref: body.provenance_ref || null,
      evidence_ref: body.evidence_ref || null,
      // Soft pointer for corrections (not a DB UPDATE of the old row):
      supersedes_event_id: body.supersedes_event_id || null,
    };
    store.events.push(event);
    return res.status(201).json({
      event,
      note: "append-only; corrections supersede via new claim/event, never rewrite history",
    });
  });

  // Convenience: unit summary
  router.get("/unit", (_req, res) => {
    const unit = getUnitNode(store.nodes);
    if (!unit) return res.status(404).json({ error: "unit_not_found" });
    return res.json({ unit: nodeToJson(unit) });
  });

  return router;
}

module.exports = { createGraphApiRouter, createMemoryGraphStore, buildSpacesTree };
