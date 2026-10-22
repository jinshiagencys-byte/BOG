-- ============================================================================
-- V2 — 04 — Exécutions, intégration GitHub et acquittements
--
-- Les colonnes GitHub reprennent volontairement les conventions déjà utilisées
-- par crawl_reports : github_run_id + github_run_attempt + github_run_url.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Exécutions : métadonnées, compteurs, manifeste
-- ---------------------------------------------------------------------------

alter table public.test_runs
  add column if not exists run_number integer,
  add column if not exists github_run_id bigint,
  add column if not exists github_run_attempt integer not null default 1,
  add column if not exists github_workflow text,
  add column if not exists github_run_url text,
  add column if not exists branch text,
  add column if not exists environment text,
  add column if not exists ci_provider text,
  add column if not exists commit_sha text,
  add column if not exists commit_message text,
  add column if not exists author text,
  add column if not exists pr_number integer,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists duration_ms integer,
  add column if not exists passed_count integer not null default 0,
  add column if not exists failed_count integer not null default 0,
  add column if not exists blocked_count integer not null default 0,
  add column if not exists skipped_count integer not null default 0,
  add column if not exists total_count integer not null default 0,
  add column if not exists suite_label text,
  add column if not exists report jsonb,
  add column if not exists error_message text,
  add column if not exists executor text not null default 'antigravity',
  add column if not exists model text,
  add column if not exists side_effects jsonb not null default '[]'::jsonb,
  add column if not exists rerun_of uuid,
  add column if not exists manifest jsonb,
  add column if not exists manifest_hash text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.test_runs
  add constraint test_runs_rerun_of_fkey
    foreign key (rerun_of) references public.test_runs(id) on delete set null,
  add constraint test_runs_counts_chk
    check (
      passed_count >= 0
      and failed_count >= 0
      and blocked_count >= 0
      and skipped_count >= 0
      and total_count >= 0
    );

create unique index if not exists test_runs_site_run_number_key
  on public.test_runs (site_id, run_number)
  where run_number is not null;

create unique index if not exists test_runs_github_key
  on public.test_runs (site_id, github_run_id, github_run_attempt)
  where github_run_id is not null;

create index if not exists test_runs_plan_id_idx
  on public.test_runs (plan_id);

create index if not exists test_runs_status_started_idx
  on public.test_runs (site_id, status, started_at desc);

drop trigger if exists trg_test_runs_updated_at on public.test_runs;
create trigger trg_test_runs_updated_at
  before update on public.test_runs
  for each row execute function public.touch_updated_at();

-- `trigger` est un mot-clé : on le quote systématiquement.
alter table public.test_runs drop constraint if exists test_runs_status_check;
alter table public.test_runs
  add constraint test_runs_status_check
    check (status in ('running', 'passed', 'failed', 'error', 'cancelled'));

alter table public.test_runs drop constraint if exists test_runs_trigger_check;
alter table public.test_runs
  add constraint test_runs_trigger_check
    check ("trigger" in ('new_site', 'schedule', 'manual', 'ci'));

-- Une suppression de projet/plan doit emporter l'historique, pas le bloquer.
alter table public.test_runs drop constraint if exists test_runs_plan_id_fkey;
alter table public.test_runs
  add constraint test_runs_plan_id_fkey
    foreign key (plan_id) references public.test_plans(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Résultats : diagnostic d'échec et artefacts
-- ---------------------------------------------------------------------------

alter table public.test_case_results
  add column if not exists failure_message text,
  add column if not exists stack_trace text,
  add column if not exists retry_count integer not null default 0,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists artifacts jsonb not null default '[]'::jsonb,
  add column if not exists severity text
    check (severity is null or severity in ('P0', 'P1', 'P2'));

create index if not exists test_case_results_run_status_idx
  on public.test_case_results (run_id, status);

alter table public.test_case_results drop constraint if exists test_case_results_case_id_fkey;
alter table public.test_case_results
  add constraint test_case_results_case_id_fkey
    foreign key (case_id) references public.test_cases(id) on delete cascade;

-- Idempotence des étapes : un rejeu met à jour la ligne au lieu de dupliquer.
create unique index if not exists test_step_results_result_step_key
  on public.test_step_results (case_result_id, step_id);

-- Preuve structurée produite par l'agent (url, http_status, console, network, screenshot).
alter table public.test_step_results
  add column if not exists precondition text,
  add column if not exists evidence jsonb not null default '{}'::jsonb;

create index if not exists test_step_results_case_result_idx
  on public.test_step_results (case_result_id);

alter table public.test_step_results drop constraint if exists test_step_results_step_id_fkey;
alter table public.test_step_results
  add constraint test_step_results_step_id_fkey
    foreign key (step_id) references public.test_steps(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Cas de test : date de mise à jour et priorité par défaut
-- ---------------------------------------------------------------------------

alter table public.test_cases
  add column if not exists updated_at timestamptz not null default now();

alter table public.test_cases
  alter column priority set default 'medium';

drop trigger if exists trg_test_cases_updated_at on public.test_cases;
create trigger trg_test_cases_updated_at
  before update on public.test_cases
  for each row execute function public.touch_updated_at();

alter table public.test_plans
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_test_plans_updated_at on public.test_plans;
create trigger trg_test_plans_updated_at
  before update on public.test_plans
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Intégration GitHub (aucun token en base)
-- ---------------------------------------------------------------------------

create table if not exists public.github_integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  repo_full_name text not null,
  workflow_file text not null default 'antigravity-qa.yml',
  default_branch text not null default 'main',
  installation_id bigint,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_integrations_org_repo_key unique (org_id, repo_full_name)
);

drop trigger if exists trg_github_integrations_updated_at on public.github_integrations;
create trigger trg_github_integrations_updated_at
  before update on public.github_integrations
  for each row execute function public.touch_updated_at();

comment on table public.github_integrations is
  'Références GitHub par organisation. La clé privée de la GitHub App reste dans les secrets des Edge Functions.';

-- Jetons éphémères remis au workflow pour un run précis. Seul le hash est stocké.
create table if not exists public.ci_run_tokens (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.test_runs(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint ci_run_tokens_hash_key unique (token_hash)
);

create index if not exists ci_run_tokens_run_idx
  on public.ci_run_tokens (run_id);

-- Acquittement par utilisateur (remplace le sessionStorage de la démo).
create table if not exists public.run_acknowledgements (
  run_id uuid not null references public.test_runs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  primary key (run_id, user_id)
);

create index if not exists run_acknowledgements_user_idx
  on public.run_acknowledgements (user_id);

-- ---------------------------------------------------------------------------
-- Nettoyage d'index dupliqués sur crawl_reports
-- ---------------------------------------------------------------------------

-- Ces deux index sont strictement redondants avec les contraintes/colonnes
-- déjà indexées. On garde la version adossée à la contrainte unique.
drop index if exists public.crawl_reports_run_uniq;
drop index if exists public.crawl_reports_site_idx;
