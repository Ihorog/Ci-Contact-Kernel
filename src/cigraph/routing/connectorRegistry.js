'use strict';

const { SCOPE, DOMAIN } = require('../registry');

const CONNECTORS = Object.freeze({
  github: {
    name: 'github',
    role: 'Source-control transport connector for repositories, pull requests, and files.',
    semantic_ownership: [{ scope: SCOPE.WORK, domain: DOMAIN.SOURCE_CONTROL }],
    write_authority: 'Can write repository metadata and content through repository workflows, but does not own record semantics.',
    capabilities: ['repo_metadata', 'blob_fetch', 'pull_request_events'],
    trust_level: 'transport'
  },
  supabase: {
    name: 'supabase',
    role: 'Primary relational storage connector for graph persistence and projections.',
    semantic_ownership: [{ scope: SCOPE.HOME, domain: DOMAIN.ASSET_REGISTRY }, { scope: SCOPE.CORE, domain: DOMAIN.IDENTITY_ACCESS }],
    write_authority: 'Can persist canonical rows in managed relational storage.',
    capabilities: ['relational_storage', 'row_history', 'rls_enforcement'],
    trust_level: 'storage'
  },
  cloudflare: {
    name: 'cloudflare',
    role: 'Edge networking and tunnel transport connector.',
    semantic_ownership: [{ scope: SCOPE.HOME, domain: DOMAIN.NETWORK_COMPUTE }, { scope: SCOPE.WORK, domain: DOMAIN.OPERATIONS }],
    write_authority: 'Can update edge routes and edge KV, but semantic ownership is still rule-driven.',
    capabilities: ['tunnel_metadata', 'edge_config', 'kv_storage'],
    trust_level: 'executor'
  },
  openai: {
    name: 'openai',
    role: 'LLM enrichment connector for extraction and semantic hints.',
    semantic_ownership: [],
    write_authority: 'No semantic write authority; enrichment only.',
    capabilities: ['classification', 'summarization', 'relation_extraction'],
    trust_level: 'enricher'
  },
  local_node: {
    name: 'local_node',
    role: 'Local device and execution connector.',
    semantic_ownership: [{ scope: SCOPE.HOME, domain: DOMAIN.ENERGY }, { scope: SCOPE.ACTION, domain: DOMAIN.TASKS }],
    write_authority: 'Can execute commands on local resources when separately authorized.',
    capabilities: ['device_io', 'filesystem', 'local_automation'],
    trust_level: 'executor'
  },
  analytics: {
    name: 'analytics',
    role: 'Derived score and predictive-model enrichment connector.',
    semantic_ownership: [],
    write_authority: 'No semantic write authority; emits derived or predictive observations.',
    capabilities: ['risk_scoring', 'anomaly_detection', 'forecasting'],
    trust_level: 'enricher'
  }
});

function getConnector(name) {
  if (!name) return null;
  return CONNECTORS[String(name).toLowerCase()] || null;
}

function resolveConnectorOwnership(sourceName, classifiedRecord) {
  return {
    connector: getConnector(sourceName),
    classifiedRecord,
    overridesSemanticOwnership: false
  };
}

module.exports = { CONNECTORS, getConnector, resolveConnectorOwnership };
