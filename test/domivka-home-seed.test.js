"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  SEED_IDS,
  CI_ID_RE,
  SEED_NODES,
  SEED_EDGES,
  seedHomeRegistry,
  getRoomNodes,
  getUnitNode,
  TRUTH,
  CLASS_SPACE,
  CLASS_DEVICE,
} = require("../src/cigraph/homeSeed");

const SECRET_KEY_RE = /password|wifi_key|wifi_password|api_key|private_key|token|secret|serial/i;
const SECRET_VAL_RE = /^(?:[A-Za-z0-9+\/]{24,}={0,2}|sk-[A-Za-z0-9]{10,}|[0-9A-F:]{11,})$/;

describe("domivka home seed", () => {
  it("seeds registry with expected room count and areas", () => {
    const { nodes } = seedHomeRegistry();
    const rooms = getRoomNodes(nodes);
    assert.equal(rooms.length, 5);

    const byLabel = Object.fromEntries(rooms.map((r) => [r.metadata.label, r.metadata.area_m2]));
    assert.equal(byLabel.room_1, 17.9);
    assert.equal(byLabel.room_2, 11.8);
    assert.equal(byLabel.room_3, 8.6);
    assert.equal(byLabel.kitchen, 7.5);
    assert.equal(byLabel.bathroom, 3.0);

    const unit = getUnitNode(nodes);
    assert.ok(unit);
    assert.equal(unit.metadata.area_total_m2, 61.3);
    assert.equal(unit.metadata.area_living_m2, 38.3);
    assert.equal(unit.metadata.area_utility_m2, 23.0);
    assert.equal(unit.metadata.floor, 3);
    assert.equal(unit.metadata.floors_total, 5);
    assert.equal(unit.metadata.ceiling_height_m, 2.5);
    assert.equal(unit.truth_status, TRUTH.VERIFIED);
  });

  it("uses opaque ci_ + 16 hex Ci-IDs", () => {
    for (const id of Object.values(SEED_IDS)) {
      assert.match(id, CI_ID_RE);
    }
    for (const n of SEED_NODES) {
      assert.match(n.ci_id, CI_ID_RE);
    }
  });

  it("marks spaces VERIFIED and devices OBSERVED", () => {
    const spaces = SEED_NODES.filter((n) => n.primary_class === CLASS_SPACE);
    const devices = SEED_NODES.filter((n) => n.primary_class === CLASS_DEVICE);
    assert.ok(spaces.length >= 8);
    assert.equal(devices.length, 8);
    for (const s of spaces) assert.equal(s.truth_status, TRUTH.VERIFIED);
    for (const d of devices) assert.equal(d.truth_status, TRUTH.OBSERVED);
  });

  it("has CONTAINS/PART_OF room hierarchy and LOCATED_IN for bath devices", () => {
    const containsRooms = SEED_EDGES.filter(
      (e) => e.from_ci_id === SEED_IDS.unit && e.relation_type === "CONTAINS"
    );
    assert.equal(containsRooms.length, 5);

    const bathLocated = SEED_EDGES.filter(
      (e) =>
        e.relation_type === "LOCATED_IN" &&
        e.to_ci_id === SEED_IDS.bathroom &&
        [SEED_IDS.water_meter_cold, SEED_IDS.water_meter_hot, SEED_IDS.boiler].includes(e.from_ci_id)
    );
    assert.equal(bathLocated.length, 3);
  });

  it("rejects secret-looking metadata fields", () => {
    for (const n of SEED_NODES) {
      const keys = Object.keys(n.metadata || {});
      for (const k of keys) {
        assert.equal(SECRET_KEY_RE.test(k), false, "secret-like key: " + k);
      }
      const blob = JSON.stringify(n.metadata || {});
      assert.equal(/password|wifi_key|api_key|private_key/i.test(blob), false);
      for (const v of Object.values(n.metadata || {})) {
        if (typeof v === "string") {
          assert.equal(SECRET_VAL_RE.test(v), false, "secret-like value on " + n.ci_id);
        }
      }
    }
  });

  it("is idempotent when re-seeding", () => {
    const store = seedHomeRegistry();
    const again = seedHomeRegistry(store);
    assert.equal(again.nodes.size, SEED_NODES.length);
    assert.equal(again.edges.size, SEED_EDGES.length);
  });
});
