"use strict";

/**
 * Domivka Phase 1 — HOME spaces + observed devices seed (local-first).
 * Mirrors supabase/migrations/20260906_domivka_home_spaces_seed.sql Ci-IDs.
 * Does not invent a parallel schema; shapes match ci_graph_nodes / ci_graph_edges.
 *
 * Soft-requires ./registry when present (in-repo); falls back to literal tokens.
 */

let registry = null;
try {
  registry = require("./registry");
} catch (_err) {
  registry = null;
}

const SCOPE_HOME = (registry && registry.SCOPE.HOME) || "HOME";
const CLASS_SPACE = (registry && registry.CLASS.SPACE) || "SPACE";
const CLASS_DEVICE = (registry && registry.CLASS.DEVICE) || "DEVICE";
const DOMAIN = (registry && registry.DOMAIN) || {
  HOUSING_SPACE: "HOUSING_SPACE",
  ENERGY: "ENERGY",
  WATER: "WATER",
  NETWORK_COMPUTE: "NETWORK_COMPUTE",
  STORAGE_BACKUP: "STORAGE_BACKUP",
};
const TRUTH = (registry && registry.TRUTH_STATUS) || {
  VERIFIED: "VERIFIED",
  OBSERVED: "OBSERVED",
};
const TEMPORAL = (registry && registry.TEMPORAL_LAYER) || { ACTUAL: "ACTUAL" };
const RELATION = (registry && registry.RELATION) || {
  CONTAINS: "CONTAINS",
  PART_OF: "PART_OF",
  LOCATED_IN: "LOCATED_IN",
  MOUNTED_ON: "MOUNTED_ON",
};
const LIFECYCLE = (registry && registry.LIFECYCLE_STATE) || {
  ACTIVE: "ACTIVE",
  REGISTERED: "REGISTERED",
};

/** Fixed opaque Ci-IDs — generated once; keep stable across SQL + JS. */
const SEED_IDS = Object.freeze({
  property: "ci_f19776d59b81cd3f",
  building: "ci_0ced42272ef13347",
  unit: "ci_88b9bb9581b24db3",
  room_17_9: "ci_3a6bfd2e6494389d",
  room_11_8: "ci_2d27bf6143cc5d2e",
  room_8_6: "ci_8d2810a8ec55f22e",
  kitchen: "ci_e461a5335ac33277",
  bathroom: "ci_98e5b0d539aafba0",
  electrical_panel_1: "ci_36e0fd7d91a236bd",
  electrical_panel_2: "ci_6789d3b8300c11f9",
  water_meter_cold: "ci_3f8f9e7b601c97f7",
  water_meter_hot: "ci_c2b6bab0c5f3d755",
  boiler: "ci_7810768988e429a4",
  keenetic_ultra: "ci_72f97075d1e7aac7",
  orange_pi_3_lts: "ci_441e5ebd17ab21bf",
  usb_storage_on_router: "ci_391d8d2114418114",
});

const EVIDENCE_ID = "5105796e-afb8-4a52-951d-eddf2ad8b6a8";

const CI_ID_RE = /^ci_[0-9a-f]{16}$/;

function spaceNode(ci_id, canonical_name, subtype, metadata, truth, confidence) {
  return {
    ci_id,
    canonical_name,
    primary_class: CLASS_SPACE,
    subtype,
    roles: [],
    scopes: [SCOPE_HOME],
    domains: [DOMAIN.HOUSING_SPACE],
    owner_scope: SCOPE_HOME,
    owner_domain: DOMAIN.HOUSING_SPACE,
    semantic_address: null,
    identity_status: "ACTIVE",
    lifecycle_state: LIFECYCLE.REGISTERED || "REGISTERED",
    truth_status: truth,
    confidence,
    metadata,
  };
}

function deviceNode(ci_id, canonical_name, subtype, owner_domain, metadata) {
  return {
    ci_id,
    canonical_name,
    primary_class: CLASS_DEVICE,
    subtype,
    roles: [],
    scopes: [SCOPE_HOME],
    domains: [owner_domain],
    owner_scope: SCOPE_HOME,
    owner_domain,
    semantic_address: null,
    identity_status: "ACTIVE",
    lifecycle_state: LIFECYCLE.ACTIVE || "ACTIVE",
    truth_status: TRUTH.OBSERVED,
    confidence: 0.7,
    metadata,
  };
}

function edge(edge_id, from_ci_id, relation_type, to_ci_id, truth, confidence) {
  return {
    edge_id,
    from_ci_id,
    relation_type,
    to_ci_id,
    truth_status: truth,
    confidence,
    temporal_layer: TEMPORAL.ACTUAL,
    valid_from: null,
    valid_to: null,
    observed_at: "2026-08-26T00:00:00.000Z",
    provenance_claim_id: null,
    evidence_ref: null,
    is_active: true,
  };
}

const SEED_NODES = Object.freeze([
  spaceNode(SEED_IDS.property, "Властивість (baseline)", "property", { label: "property" }, TRUTH.VERIFIED, 0.8),
  spaceNode(SEED_IDS.building, "Будівля (baseline)", "building", { label: "building", floors_total: 5 }, TRUTH.VERIFIED, 0.9),
  spaceNode(
    SEED_IDS.unit,
    "Квартира",
    "unit",
    {
      label: "apartment_unit",
      area_total_m2: 61.3,
      area_living_m2: 38.3,
      area_utility_m2: 23.0,
      floor: 3,
      floors_total: 5,
      ceiling_height_m: 2.5,
      source: "tech_passport",
    },
    TRUTH.VERIFIED,
    0.95
  ),
  spaceNode(SEED_IDS.room_17_9, "Кімната 1", "room", { label: "room_1", area_m2: 17.9 }, TRUTH.VERIFIED, 0.95),
  spaceNode(SEED_IDS.room_11_8, "Кімната 2", "room", { label: "room_2", area_m2: 11.8 }, TRUTH.VERIFIED, 0.95),
  spaceNode(SEED_IDS.room_8_6, "Кімната 3", "room", { label: "room_3", area_m2: 8.6 }, TRUTH.VERIFIED, 0.95),
  spaceNode(SEED_IDS.kitchen, "Кухня", "room", { label: "kitchen", area_m2: 7.5, room_kind: "kitchen" }, TRUTH.VERIFIED, 0.95),
  spaceNode(SEED_IDS.bathroom, "Ванна", "room", { label: "bathroom", area_m2: 3.0, room_kind: "bathroom" }, TRUTH.VERIFIED, 0.95),
  deviceNode(SEED_IDS.electrical_panel_1, "electrical_panel_1", "electrical_panel", DOMAIN.ENERGY, { label: "electrical_panel_1" }),
  deviceNode(SEED_IDS.electrical_panel_2, "electrical_panel_2", "electrical_panel", DOMAIN.ENERGY, { label: "electrical_panel_2" }),
  deviceNode(SEED_IDS.water_meter_cold, "water_meter_cold", "water_meter", DOMAIN.WATER, { label: "water_meter_cold", medium: "cold" }),
  deviceNode(SEED_IDS.water_meter_hot, "water_meter_hot", "water_meter", DOMAIN.WATER, { label: "water_meter_hot", medium: "hot" }),
  deviceNode(SEED_IDS.boiler, "boiler", "boiler", DOMAIN.WATER, { label: "boiler" }),
  deviceNode(SEED_IDS.keenetic_ultra, "keenetic_ultra", "router", DOMAIN.NETWORK_COMPUTE, { label: "keenetic_ultra", model: "Keenetic Ultra" }),
  deviceNode(SEED_IDS.orange_pi_3_lts, "orange_pi_3_lts", "sbc", DOMAIN.NETWORK_COMPUTE, { label: "orange_pi_3_lts", model: "Orange Pi 3 LTS" }),
  deviceNode(SEED_IDS.usb_storage_on_router, "usb_storage_on_router", "usb_storage", DOMAIN.STORAGE_BACKUP, { label: "usb_storage_on_router", attachment: "router_usb" }),
]);

const SEED_EDGES = Object.freeze([
  edge("c0df8f09-8b20-4bef-8168-d97e139507cc", SEED_IDS.property, RELATION.CONTAINS, SEED_IDS.building, TRUTH.VERIFIED, 0.95),
  edge("9d5b67cd-243a-47d8-a7a5-f94ea2343c82", SEED_IDS.building, RELATION.PART_OF, SEED_IDS.property, TRUTH.VERIFIED, 0.95),
  edge("f8d19d2c-180b-405a-85a8-263313358fb2", SEED_IDS.building, RELATION.CONTAINS, SEED_IDS.unit, TRUTH.VERIFIED, 0.95),
  edge("d082d9b9-09f0-443c-a127-c592b998d231", SEED_IDS.unit, RELATION.PART_OF, SEED_IDS.building, TRUTH.VERIFIED, 0.95),
  edge("3293a28a-6d7a-4ba2-95e5-d9f92b295b45", SEED_IDS.unit, RELATION.CONTAINS, SEED_IDS.room_17_9, TRUTH.VERIFIED, 0.95),
  edge("e47e9601-2cd1-4e74-b8ea-de044d804cd6", SEED_IDS.room_17_9, RELATION.PART_OF, SEED_IDS.unit, TRUTH.VERIFIED, 0.95),
  edge("60e4e563-3b34-47db-832d-93a8017f0c78", SEED_IDS.unit, RELATION.CONTAINS, SEED_IDS.room_11_8, TRUTH.VERIFIED, 0.95),
  edge("7b4ccd1f-067a-4b2b-b4de-343433333306", SEED_IDS.room_11_8, RELATION.PART_OF, SEED_IDS.unit, TRUTH.VERIFIED, 0.95),
  edge("191886f3-90e4-4308-8916-6fc17312e023", SEED_IDS.unit, RELATION.CONTAINS, SEED_IDS.room_8_6, TRUTH.VERIFIED, 0.95),
  edge("dd446492-aefe-42f1-9e21-579c787aa574", SEED_IDS.room_8_6, RELATION.PART_OF, SEED_IDS.unit, TRUTH.VERIFIED, 0.95),
  edge("5c2d40fe-af4b-4e86-9283-fc16cb0f4f18", SEED_IDS.unit, RELATION.CONTAINS, SEED_IDS.kitchen, TRUTH.VERIFIED, 0.95),
  edge("4c8e3d57-b928-4d02-8353-eea149c98335", SEED_IDS.kitchen, RELATION.PART_OF, SEED_IDS.unit, TRUTH.VERIFIED, 0.95),
  edge("4948c155-ab13-4d80-aafa-18523d8d9714", SEED_IDS.unit, RELATION.CONTAINS, SEED_IDS.bathroom, TRUTH.VERIFIED, 0.95),
  edge("f8b86702-162c-4702-a631-37e0a29ede0c", SEED_IDS.bathroom, RELATION.PART_OF, SEED_IDS.unit, TRUTH.VERIFIED, 0.95),
  edge("2e2345af-e6ef-4121-8ea6-b9152df14681", SEED_IDS.electrical_panel_1, RELATION.LOCATED_IN, SEED_IDS.unit, TRUTH.OBSERVED, 0.7),
  edge("5e6111cf-5799-46d3-bc90-604caff8ccf5", SEED_IDS.electrical_panel_2, RELATION.LOCATED_IN, SEED_IDS.unit, TRUTH.OBSERVED, 0.7),
  edge("b82f5f45-185f-4266-b373-9e9feb7b1bce", SEED_IDS.water_meter_cold, RELATION.LOCATED_IN, SEED_IDS.bathroom, TRUTH.OBSERVED, 0.7),
  edge("dbd5a12b-0e4d-4441-b705-2b7f5f64fec4", SEED_IDS.water_meter_hot, RELATION.LOCATED_IN, SEED_IDS.bathroom, TRUTH.OBSERVED, 0.7),
  edge("eeb7fc64-667a-41c7-8267-f5ba38c61430", SEED_IDS.boiler, RELATION.LOCATED_IN, SEED_IDS.bathroom, TRUTH.OBSERVED, 0.7),
  edge("907dc734-6986-4383-94c6-b6d23fc49feb", SEED_IDS.keenetic_ultra, RELATION.LOCATED_IN, SEED_IDS.unit, TRUTH.OBSERVED, 0.7),
  edge("2026ef22-3469-49d8-b466-943111b2a006", SEED_IDS.orange_pi_3_lts, RELATION.LOCATED_IN, SEED_IDS.unit, TRUTH.OBSERVED, 0.7),
  edge("d383f869-c602-41aa-aecf-90f173c9a242", SEED_IDS.usb_storage_on_router, RELATION.LOCATED_IN, SEED_IDS.unit, TRUTH.OBSERVED, 0.7),
  edge("e9654927-972a-4151-ae37-64d46a38deed", SEED_IDS.usb_storage_on_router, RELATION.MOUNTED_ON, SEED_IDS.keenetic_ultra, TRUTH.OBSERVED, 0.7),
]);

const SEED_EVIDENCE = Object.freeze({
  evidence_id: EVIDENCE_ID,
  evidence_type: "tech_passport_excerpt",
  source_ref: "vault://household/docs/tech-passport-areas#redacted",
  storage_ref: null,
  content_hash: null,
  supports_claim_id: null,
  refutes_claim_id: null,
  supports_action_ref: null,
  verifier_identity: "domivka-phase1-seed",
  verifier_type: "document",
  verifier_version: "2026-08-26",
  verification_status: "VERIFIED",
  verified_at: "2026-08-26T00:00:00.000Z",
  metadata: { note: "areas only; no address PII" },
});

/**
 * Seed an in-memory or file-backed registry-like store.
 * @param {{ nodes?: Map|Object, edges?: Map|Object, evidence?: Map|Object }|null} store
 * @returns {{ nodes: Map, edges: Map, evidence: Map }}
 */
function seedHomeRegistry(store) {
  const nodes = store && store.nodes instanceof Map ? store.nodes : new Map(store && store.nodes ? Object.entries(store.nodes) : []);
  const edges = store && store.edges instanceof Map ? store.edges : new Map(store && store.edges ? Object.entries(store.edges) : []);
  const evidence = store && store.evidence instanceof Map ? store.evidence : new Map(store && store.evidence ? Object.entries(store.evidence) : []);

  for (const n of SEED_NODES) {
    if (!nodes.has(n.ci_id)) nodes.set(n.ci_id, { ...n, metadata: { ...n.metadata } });
  }
  for (const e of SEED_EDGES) {
    if (!edges.has(e.edge_id)) edges.set(e.edge_id, { ...e });
  }
  if (!evidence.has(SEED_EVIDENCE.evidence_id)) {
    evidence.set(SEED_EVIDENCE.evidence_id, { ...SEED_EVIDENCE, metadata: { ...SEED_EVIDENCE.metadata } });
  }
  return { nodes, edges, evidence };
}

function getRoomNodes(nodesMap) {
  const nodes = nodesMap instanceof Map ? [...nodesMap.values()] : SEED_NODES;
  return nodes.filter((n) => n.primary_class === CLASS_SPACE && n.subtype === "room");
}

function getUnitNode(nodesMap) {
  const nodes = nodesMap instanceof Map ? nodesMap : null;
  if (nodes) return nodes.get(SEED_IDS.unit) || null;
  return SEED_NODES.find((n) => n.ci_id === SEED_IDS.unit) || null;
}

module.exports = {
  SEED_IDS,
  EVIDENCE_ID,
  CI_ID_RE,
  SEED_NODES,
  SEED_EDGES,
  SEED_EVIDENCE,
  seedHomeRegistry,
  getRoomNodes,
  getUnitNode,
  SCOPE_HOME,
  CLASS_SPACE,
  CLASS_DEVICE,
  DOMAIN,
  TRUTH,
  TEMPORAL,
  RELATION,
};
