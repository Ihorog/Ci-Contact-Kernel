"use strict";

const TABLES = Object.freeze({
  ingest: 'ci_graph_ingest',
  node: 'ci_graph_nodes',
  claim: 'ci_graph_claims',
  edge: 'ci_graph_edges',
  classificationRun: 'ci_graph_classification_runs',
  conflict: 'ci_graph_conflicts',
  route: 'ci_graph_routes'
});

let cachedClient = null;

function toClientError(message) {
  return { message };
}

function loadCreateClient() {
  try {
    return require('@supabase/supabase-js').createClient;
  } catch {
    return null;
  }
}

function getClient() {
  if (cachedClient) return { client: cachedClient, error: null };

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return { client: null, error: toClientError('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.') };
  }

  const createClient = loadCreateClient();
  if (typeof createClient !== 'function') {
    return { client: null, error: toClientError('The @supabase/supabase-js package is not installed in this environment.') };
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return { client: cachedClient, error: null };
}

async function insertOne(table, record) {
  const { client, error } = getClient();
  if (error) return { data: null, error };
  return client.from(table).insert(record).select();
}

function insertIngestRecord(record) {
  return insertOne(TABLES.ingest, record);
}

function insertNode(record) {
  return insertOne(TABLES.node, record);
}

function insertClaim(record) {
  return insertOne(TABLES.claim, record);
}

function insertEdge(record) {
  return insertOne(TABLES.edge, record);
}

function insertClassificationRun(run) {
  return insertOne(TABLES.classificationRun, run);
}

function insertConflict(conflict) {
  return insertOne(TABLES.conflict, conflict);
}

function insertRoute(route) {
  return insertOne(TABLES.route, route);
}

function resolveConflict(conflictId, decision) {
  const { client, error } = getClient();
  if (error) return Promise.resolve({ data: null, error });
  return client
    .from(TABLES.conflict)
    .update({
      status: 'RESOLVED',
      resolution_action: 'MANUAL_DECISION',
      resolution_decision: decision,
      resolved_at: new Date().toISOString()
    })
    .eq('conflict_id', conflictId)
    .select();
}

module.exports = {
  TABLES,
  insertIngestRecord,
  insertNode,
  insertClaim,
  insertEdge,
  insertClassificationRun,
  insertConflict,
  insertRoute,
  resolveConflict
};
