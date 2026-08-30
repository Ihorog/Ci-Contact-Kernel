'use strict';

const { DATA_ROLES } = require('../storage/dataRoles');

const STORAGE_TARGETS = Object.freeze({
  SUPABASE: 'supabase',
  LOCAL_KV: 'local_kv',
  CLOUDFLARE_KV: 'cloudflare_kv',
  SEARCH_INDEX: 'search_index'
});

function dedupe(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function resolveStorageTargets(ownershipResult = {}, dataRole) {
  const targets = dedupe(ownershipResult.storage_targets || []);

  switch (dataRole) {
    case DATA_ROLES.TRANSPORT_RAW:
    case DATA_ROLES.AUDIT_PROVENANCE:
    case DATA_ROLES.CONFLICT_RECORD:
      return dedupe([STORAGE_TARGETS.SUPABASE, ...targets]);
    case DATA_ROLES.SEARCH_PROJECTION:
      return dedupe([STORAGE_TARGETS.SEARCH_INDEX, ...targets]);
    case DATA_ROLES.CACHE:
      return dedupe([STORAGE_TARGETS.LOCAL_KV, STORAGE_TARGETS.CLOUDFLARE_KV, ...targets]);
    case DATA_ROLES.PREDICTED_STATE:
      return dedupe([STORAGE_TARGETS.SUPABASE, STORAGE_TARGETS.CLOUDFLARE_KV, ...targets]);
    default:
      return targets;
  }
}

module.exports = { STORAGE_TARGETS, resolveStorageTargets };
