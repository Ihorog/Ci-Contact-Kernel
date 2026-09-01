-- CI-EXEC-01A: atomic execution registry for Ci+
-- Private schema: intentionally not exposed through Supabase Data API.

create schema if not exists ci_exec;
revoke all on schema ci_exec from public, anon, authenticated;

create table if not exists ci_exec.changesets (
  ci_id uuid primary key,
  package_code text not null,
  revision text not null,
  state text not null check (state in ('DRAFT','READY','APPROVED','EXECUTING','VERIFIED','FAILED','ROLLED_BACK','QUARANTINED')),
  scope jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  completed_at timestamptz
);
create table if not exists ci_exec.approvals (
  id bigint generated always as identity primary key,
  ci_id uuid not null references ci_exec.changesets(ci_id) on delete restrict,
  approval_token text not null,
  approved_by text not null,
  approved_at timestamptz not null default now(),
  unique (ci_id, approval_token)
);
create table if not exists ci_exec.executions (
  id bigint generated always as identity primary key,
  ci_id uuid not null references ci_exec.changesets(ci_id) on delete restrict,
  service text not null,
  operation text not null,
  status text not null check (status in ('PENDING','RUNNING','SUCCEEDED','FAILED','ROLLED_BACK','SKIPPED')),
  external_ref text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  details jsonb not null default '{}'::jsonb
);
create table if not exists ci_exec.evidence (
  id bigint generated always as identity primary key,
  ci_id uuid not null references ci_exec.changesets(ci_id) on delete restrict,
  evidence_type text not null,
  service text not null,
  external_ref text not null,
  payload jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  unique (ci_id, service, evidence_type, external_ref)
);
create table if not exists ci_exec.rollbacks (
  id bigint generated always as identity primary key,
  ci_id uuid not null references ci_exec.changesets(ci_id) on delete restrict,
  service text not null,
  operation text not null,
  status text not null check (status in ('AVAILABLE','RUNNING','SUCCEEDED','FAILED','NOT_REQUIRED')),
  external_ref text,
  details jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now()
);
create index if not exists executions_ci_id_idx on ci_exec.executions(ci_id);
create index if not exists evidence_ci_id_idx on ci_exec.evidence(ci_id);
create index if not exists rollbacks_ci_id_idx on ci_exec.rollbacks(ci_id);
alter table ci_exec.changesets enable row level security;
alter table ci_exec.approvals enable row level security;
alter table ci_exec.executions enable row level security;
alter table ci_exec.evidence enable row level security;
alter table ci_exec.rollbacks enable row level security;
comment on schema ci_exec is 'Private Ci+ execution transaction and evidence registry';
