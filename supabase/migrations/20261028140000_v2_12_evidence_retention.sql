-- ============================================================================
-- V2 — 12 — Rétention des preuves vidéo
--
-- Le bucket qa-evidence est plafonné (25 Mo par fichier) et le plan gratuit
-- offre 1 Go : sans purge, les vidéos s'accumulent indéfiniment. La policy de
-- rétention est portée par la base, pas par le runner :
--
--   cas réussi / bloqué / ignoré : 30 jours
--   cas échoué                  : 90 jours (les preuves d'échec sont relues)
--   objet orphelin (run absurde) : 30 jours après le dépôt
--
-- `qa_evidence_expired` ne fait que lister les chemins arrivés à échéance ;
-- la suppression réelle passe par l'API Storage (fonction purge-evidence),
-- sinon les fichiers resteraient dans le stockage objet.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Candidats à la purge
-- ---------------------------------------------------------------------------

create or replace function public.qa_evidence_expired(
  p_retention_days integer default 30,
  p_failed_retention_days integer default 90,
  p_run_id uuid default null,
  p_limit integer default 500
)
returns table (
  path text,
  run_id uuid,
  run_status text,
  run_started_at timestamptz,
  age_days integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with objects as (
    select o.name, o.created_at
    from storage.objects o
    where o.bucket_id = 'qa-evidence'
      -- <org_id>/<run_id>/<CODE>.<ext>
      and o.name ~ '^[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}/[^/]+$'
  ),
  parsed as (
    select
      objects.name,
      objects.created_at,
      split_part(objects.name, '/', 1)::uuid as org_id,
      split_part(objects.name, '/', 2)::uuid as run_id
    from objects
  ),
  joined as (
    select
      parsed.name,
      parsed.run_id,
      parsed.created_at,
      runs.status,
      runs.started_at
    from parsed
    left join public.test_runs runs on runs.id = parsed.run_id
  )
  select
    joined.name as path,
    joined.run_id,
    joined.status as run_status,
    joined.started_at as run_started_at,
    floor(
      extract(epoch from (now() - coalesce(joined.started_at, joined.created_at))) / 86400
    )::integer as age_days
  from joined
  where (p_run_id is null or joined.run_id = p_run_id)
    and coalesce(joined.started_at, joined.created_at) <
      now() - make_interval(
        days => case
          when joined.status = 'failed'
            then greatest(p_failed_retention_days, p_retention_days, 0)
          else greatest(p_retention_days, 0)
        end
      )
  order by coalesce(joined.started_at, joined.created_at) asc, joined.name asc
  limit least(greatest(p_limit, 1), 1000);
$$;

revoke all on function public.qa_evidence_expired(integer, integer, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.qa_evidence_expired(integer, integer, uuid, integer)
  to service_role;

comment on function public.qa_evidence_expired(integer, integer, uuid, integer) is
  'Chemins du bucket qa-evidence ayant dépassé la rétention (30 j, 90 j si échec).';

-- ---------------------------------------------------------------------------
-- Déclencheur quotidien
--
-- Le secret est stocké dans Vault (`evidence_purge_secret`) et jamais dans le
-- dépôt. Tant qu'il n'existe pas, la tâche ne fait rien : aucune erreur.
-- ---------------------------------------------------------------------------

create or replace function public.qa_run_evidence_purge()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where name = 'evidence_purge_secret'
  limit 1;

  if v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://ipnepkenbozwoslrhtcj.supabase.co/functions/v1/purge-evidence',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-purge-secret', v_secret
    ),
    body := jsonb_build_object('dry_run', false),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.qa_run_evidence_purge() from public, anon, authenticated;

select cron.unschedule('evidence-retention')
where exists (select 1 from cron.job where jobname = 'evidence-retention');

select cron.schedule(
  'evidence-retention',
  '17 3 * * *',
  'select public.qa_run_evidence_purge();'
);
