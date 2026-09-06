-- Domivka Phase 1 — HOME spaces + observed devices seed
-- Target: EXISTING ci_graph_* tables (Ci-Contact-Kernel).
-- Prerequisite: supabase/migrations/20240101000000_ci_graph_schema.sql
-- No DDL. INSERT only. Idempotent via ON CONFLICT DO NOTHING.
-- Ci-IDs: opaque ci_ + 16 hex (mirrored in src/cigraph/homeSeed.js).
-- No secrets, serials, Wi-Fi keys, tokens, or street addresses.

BEGIN;

-- Optional evidence pointer (tech passport areas; redacted URI)
INSERT INTO ci_graph_evidence (
  evidence_id, evidence_type, source_ref, storage_ref, content_hash,
  verification_status, verifier_identity, verifier_type, verifier_version,
  verified_at, metadata
) VALUES (
  '5105796e-afb8-4a52-951d-eddf2ad8b6a8',
  'tech_passport_excerpt',
  'vault://household/docs/tech-passport-areas#redacted',
  NULL,
  NULL,
  'VERIFIED',
  'domivka-phase1-seed',
  'document',
  '2026-08-26',
  TIMESTAMPTZ '2026-08-26T00:00:00Z',
  '{"note":"areas only; no address PII"}'::jsonb
)
ON CONFLICT (evidence_id) DO NOTHING;

-- SPACE hierarchy: property → building → unit → rooms
INSERT INTO ci_graph_nodes (
  ci_id, canonical_name, primary_class, subtype, roles, scopes, domains,
  owner_scope, owner_domain, identity_status, lifecycle_state, truth_status,
  confidence, metadata
) VALUES
  (
    'ci_f19776d59b81cd3f', 'Властивість (baseline)', 'SPACE', 'property',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['HOUSING_SPACE']::TEXT[],
    'HOME', 'HOUSING_SPACE', 'ACTIVE', 'REGISTERED', 'VERIFIED', 0.80,
    '{"label":"property"}'::jsonb
  ),
  (
    'ci_0ced42272ef13347', 'Будівля (baseline)', 'SPACE', 'building',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['HOUSING_SPACE']::TEXT[],
    'HOME', 'HOUSING_SPACE', 'ACTIVE', 'REGISTERED', 'VERIFIED', 0.90,
    '{"label":"building","floors_total":5}'::jsonb
  ),
  (
    'ci_88b9bb9581b24db3', 'Квартира', 'SPACE', 'unit',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['HOUSING_SPACE']::TEXT[],
    'HOME', 'HOUSING_SPACE', 'ACTIVE', 'REGISTERED', 'VERIFIED', 0.95,
    '{"label":"apartment_unit","area_total_m2":61.3,"area_living_m2":38.3,"area_utility_m2":23.0,"floor":3,"floors_total":5,"ceiling_height_m":2.50,"source":"tech_passport"}'::jsonb
  ),
  (
    'ci_3a6bfd2e6494389d', 'Кімната 1', 'SPACE', 'room',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['HOUSING_SPACE']::TEXT[],
    'HOME', 'HOUSING_SPACE', 'ACTIVE', 'REGISTERED', 'VERIFIED', 0.95,
    '{"label":"room_1","area_m2":17.9}'::jsonb
  ),
  (
    'ci_2d27bf6143cc5d2e', 'Кімната 2', 'SPACE', 'room',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['HOUSING_SPACE']::TEXT[],
    'HOME', 'HOUSING_SPACE', 'ACTIVE', 'REGISTERED', 'VERIFIED', 0.95,
    '{"label":"room_2","area_m2":11.8}'::jsonb
  ),
  (
    'ci_8d2810a8ec55f22e', 'Кімната 3', 'SPACE', 'room',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['HOUSING_SPACE']::TEXT[],
    'HOME', 'HOUSING_SPACE', 'ACTIVE', 'REGISTERED', 'VERIFIED', 0.95,
    '{"label":"room_3","area_m2":8.6}'::jsonb
  ),
  (
    'ci_e461a5335ac33277', 'Кухня', 'SPACE', 'room',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['HOUSING_SPACE']::TEXT[],
    'HOME', 'HOUSING_SPACE', 'ACTIVE', 'REGISTERED', 'VERIFIED', 0.95,
    '{"label":"kitchen","area_m2":7.5,"room_kind":"kitchen"}'::jsonb
  ),
  (
    'ci_98e5b0d539aafba0', 'Ванна', 'SPACE', 'room',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['HOUSING_SPACE']::TEXT[],
    'HOME', 'HOUSING_SPACE', 'ACTIVE', 'REGISTERED', 'VERIFIED', 0.95,
    '{"label":"bathroom","area_m2":3.0,"room_kind":"bathroom"}'::jsonb
  )
ON CONFLICT (ci_id) DO NOTHING;

-- Devices OBSERVED (no serials/secrets)
INSERT INTO ci_graph_nodes (
  ci_id, canonical_name, primary_class, subtype, roles, scopes, domains,
  owner_scope, owner_domain, identity_status, lifecycle_state, truth_status,
  confidence, metadata
) VALUES
  (
    'ci_36e0fd7d91a236bd', 'electrical_panel_1', 'DEVICE', 'electrical_panel',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['ENERGY']::TEXT[],
    'HOME', 'ENERGY', 'ACTIVE', 'ACTIVE', 'OBSERVED', 0.70,
    '{"label":"electrical_panel_1"}'::jsonb
  ),
  (
    'ci_6789d3b8300c11f9', 'electrical_panel_2', 'DEVICE', 'electrical_panel',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['ENERGY']::TEXT[],
    'HOME', 'ENERGY', 'ACTIVE', 'ACTIVE', 'OBSERVED', 0.70,
    '{"label":"electrical_panel_2"}'::jsonb
  ),
  (
    'ci_3f8f9e7b601c97f7', 'water_meter_cold', 'DEVICE', 'water_meter',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['WATER']::TEXT[],
    'HOME', 'WATER', 'ACTIVE', 'ACTIVE', 'OBSERVED', 0.70,
    '{"label":"water_meter_cold","medium":"cold"}'::jsonb
  ),
  (
    'ci_c2b6bab0c5f3d755', 'water_meter_hot', 'DEVICE', 'water_meter',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['WATER']::TEXT[],
    'HOME', 'WATER', 'ACTIVE', 'ACTIVE', 'OBSERVED', 0.70,
    '{"label":"water_meter_hot","medium":"hot"}'::jsonb
  ),
  (
    'ci_7810768988e429a4', 'boiler', 'DEVICE', 'boiler',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['WATER']::TEXT[],
    'HOME', 'WATER', 'ACTIVE', 'ACTIVE', 'OBSERVED', 0.70,
    '{"label":"boiler"}'::jsonb
  ),
  (
    'ci_72f97075d1e7aac7', 'keenetic_ultra', 'DEVICE', 'router',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['NETWORK_COMPUTE']::TEXT[],
    'HOME', 'NETWORK_COMPUTE', 'ACTIVE', 'ACTIVE', 'OBSERVED', 0.70,
    '{"label":"keenetic_ultra","model":"Keenetic Ultra"}'::jsonb
  ),
  (
    'ci_441e5ebd17ab21bf', 'orange_pi_3_lts', 'DEVICE', 'sbc',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['NETWORK_COMPUTE']::TEXT[],
    'HOME', 'NETWORK_COMPUTE', 'ACTIVE', 'ACTIVE', 'OBSERVED', 0.70,
    '{"label":"orange_pi_3_lts","model":"Orange Pi 3 LTS"}'::jsonb
  ),
  (
    'ci_391d8d2114418114', 'usb_storage_on_router', 'DEVICE', 'usb_storage',
    ARRAY[]::TEXT[], ARRAY['HOME']::TEXT[], ARRAY['STORAGE_BACKUP']::TEXT[],
    'HOME', 'STORAGE_BACKUP', 'ACTIVE', 'ACTIVE', 'OBSERVED', 0.70,
    '{"label":"usb_storage_on_router","attachment":"router_usb"}'::jsonb
  )
ON CONFLICT (ci_id) DO NOTHING;

-- Structural + location edges (fixed edge_id for idempotency)
INSERT INTO ci_graph_edges (
  edge_id, from_ci_id, relation_type, to_ci_id, truth_status, confidence,
  temporal_layer, observed_at, is_active
) VALUES
  ('c0df8f09-8b20-4bef-8168-d97e139507cc', 'ci_f19776d59b81cd3f', 'CONTAINS', 'ci_0ced42272ef13347', 'VERIFIED', 0.95, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('9d5b67cd-243a-47d8-a7a5-f94ea2343c82', 'ci_0ced42272ef13347', 'PART_OF', 'ci_f19776d59b81cd3f', 'VERIFIED', 0.95, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('f8d19d2c-180b-405a-85a8-263313358fb2', 'ci_0ced42272ef13347', 'CONTAINS', 'ci_88b9bb9581b24db3', 'VERIFIED', 0.95, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('d082d9b9-09f0-443c-a127-c592b998d231', 'ci_88b9bb9581b24db3', 'PART_OF', 'ci_0ced42272ef13347', 'VERIFIED', 0.95, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('3293a28a-6d7a-4ba2-95e5-d9f92b295b45', 'ci_88b9bb9581b24db3', 'CONTAINS', 'ci_3a6bfd2e6494389d', 'VERIFIED', 0.95, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('e47e9601-2cd1-4e74-b8ea-de044d804cd6', 'ci_3a6bfd2e6494389d', 'PART_OF', 'ci_88b9bb9581b24db3', 'VERIFIED', 0.95, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('60e4e563-3b34-47db-832d-93a8017f0c78', 'ci_88b9bb9581b24db3', 'CONTAINS', 'ci_2d27bf6143cc5d2e', 'VERIFIED', 0.95, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('7b4ccd1f-067a-4b2b-b4de-343433333306', 'ci_2d27bf6143cc5d2e', 'PART_OF', 'ci_88b9bb9581b24db3', 'VERIFIED', 0.95, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('191886f3-90e4-4308-8916-6fc17312e023', 'ci_88b9bb9581b24db3', 'CONTAINS', 'ci_8d2810a8ec55f22e', 'VERIFIED', 0.95, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('dd446492-aefe-42f1-9e21-579c787aa574', 'ci_8d2810a8ec55f22e', 'PART_OF', 'ci_88b9bb9581b24db3', 'VERIFIED', 0.95, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('5c2d40fe-af4b-4e86-9283-fc16cb0f4f18', 'ci_88b9bb9581b24db3', 'CONTAINS', 'ci_e461a5335ac33277', 'VERIFIED', 0.95, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('4c8e3d57-b928-4d02-8353-eea149c98335', 'ci_e461a5335ac33277', 'PART_OF', 'ci_88b9bb9581b24db3', 'VERIFIED', 0.95, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('4948c155-ab13-4d80-aafa-18523d8d9714', 'ci_88b9bb9581b24db3', 'CONTAINS', 'ci_98e5b0d539aafba0', 'VERIFIED', 0.95, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('f8b86702-162c-4702-a631-37e0a29ede0c', 'ci_98e5b0d539aafba0', 'PART_OF', 'ci_88b9bb9581b24db3', 'VERIFIED', 0.95, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('2e2345af-e6ef-4121-8ea6-b9152df14681', 'ci_36e0fd7d91a236bd', 'LOCATED_IN', 'ci_88b9bb9581b24db3', 'OBSERVED', 0.70, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('5e6111cf-5799-46d3-bc90-604caff8ccf5', 'ci_6789d3b8300c11f9', 'LOCATED_IN', 'ci_88b9bb9581b24db3', 'OBSERVED', 0.70, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('b82f5f45-185f-4266-b373-9e9feb7b1bce', 'ci_3f8f9e7b601c97f7', 'LOCATED_IN', 'ci_98e5b0d539aafba0', 'OBSERVED', 0.70, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('dbd5a12b-0e4d-4441-b705-2b7f5f64fec4', 'ci_c2b6bab0c5f3d755', 'LOCATED_IN', 'ci_98e5b0d539aafba0', 'OBSERVED', 0.70, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('eeb7fc64-667a-41c7-8267-f5ba38c61430', 'ci_7810768988e429a4', 'LOCATED_IN', 'ci_98e5b0d539aafba0', 'OBSERVED', 0.70, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('907dc734-6986-4383-94c6-b6d23fc49feb', 'ci_72f97075d1e7aac7', 'LOCATED_IN', 'ci_88b9bb9581b24db3', 'OBSERVED', 0.70, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('2026ef22-3469-49d8-b466-943111b2a006', 'ci_441e5ebd17ab21bf', 'LOCATED_IN', 'ci_88b9bb9581b24db3', 'OBSERVED', 0.70, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('d383f869-c602-41aa-aecf-90f173c9a242', 'ci_391d8d2114418114', 'LOCATED_IN', 'ci_88b9bb9581b24db3', 'OBSERVED', 0.70, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE),
  ('e9654927-972a-4151-ae37-64d46a38deed', 'ci_391d8d2114418114', 'MOUNTED_ON', 'ci_72f97075d1e7aac7', 'OBSERVED', 0.70, 'ACTUAL', TIMESTAMPTZ '2026-08-26T00:00:00Z', TRUE)
ON CONFLICT (edge_id) DO NOTHING;

COMMIT;
