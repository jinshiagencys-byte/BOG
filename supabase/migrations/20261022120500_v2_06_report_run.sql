-- ============================================================================
-- V2 — 06 — Manifeste de run, jeton CI et ingestion des résultats
--
-- Ces trois fonctions sont réservées au service_role : elles sont appelées par
-- les Edge Functions `start-run` et `report-run`, jamais directement par le
-- navigateur. Le workflow ne reçoit qu'un jeton éphémère propre au run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Création d'un run + manifeste figé + jeton
-- ---------------------------------------------------------------------------

create or replace function public.create_run_manifest(
  p_site_id uuid,
  p_case_ids uuid[] default null,
  p_trigger text default 'manual',
  p_branch text default null,
  p_environment text default null,
  p_commit_sha text default null,
  p_commit_message text default null,
  p_author text default null,
  p_pr_number integer default null,
  p_tags text[] default '{}'::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_site public.sites;
  v_plan public.test_plans;
  v_run public.test_runs;
  v_run_number integer;
  v_token text;
  v_manifest jsonb;
  v_case_count integer := 0;
  v_requested_count integer := 0;
begin
  if p_trigger not in ('manual', 'schedule', 'new_site', 'ci') then
    raise exception 'TRIGGER_INVALID';
  end if;

  select * into v_site
  from public.sites
  where id = p_site_id and org_id is not null;

  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  select * into v_plan
  from public.test_plans
  where site_id = p_site_id and status = 'active'
  order by version desc
  limit 1;

  if not found then
    raise exception 'NO_ACTIVE_PLAN';
  end if;

  if p_case_ids is not null and cardinality(p_case_ids) > 0 then
    select count(distinct c.id) into v_case_count
    from public.test_cases c
    where c.id = any (p_case_ids)
      and c.plan_id = v_plan.id
      and c.status = 'active';

    select count(distinct x) into v_requested_count
    from unnest(p_case_ids) as x;

    if v_case_count <> v_requested_count then
      raise exception 'CASE_NOT_IN_PLAN';
    end if;
  end if;

  -- Sérialise l'attribution des numéros de run pour un même projet.
  perform pg_advisory_xact_lock(hashtextextended(p_site_id::text, 0));

  select coalesce(max(run_number), 0) + 1 into v_run_number
  from public.test_runs
  where site_id = p_site_id;

  insert into public.test_runs (
    site_id, plan_id, "trigger", status, started_at, run_number,
    branch, environment, ci_provider, commit_sha, commit_message,
    author, pr_number, tags
  )
  values (
    p_site_id, v_plan.id, p_trigger, 'running', now(), v_run_number,
    nullif(btrim(coalesce(p_branch, '')), ''),
    nullif(btrim(coalesce(p_environment, '')), ''),
    'github-actions',
    nullif(btrim(coalesce(p_commit_sha, '')), ''),
    nullif(btrim(coalesce(p_commit_message, '')), ''),
    nullif(btrim(coalesce(p_author, '')), ''),
    p_pr_number,
    coalesce(p_tags, '{}'::text[])
  )
  returning * into v_run;

  select jsonb_build_object(
    'version', 1,
    'runId', v_run.id,
    'runNumber', v_run.run_number,
    'project', jsonb_build_object(
      'id', v_site.id,
      'slug', v_site.slug,
      'name', v_site.name,
      'url', v_site.site_url
    ),
    'planId', v_plan.id,
    'planVersion', v_plan.version,
    'interactionsMode', v_plan.interactions_mode,
    'budget', v_plan.budget,
    'playbookCoverage', v_plan.playbook_coverage,
    'executor', 'antigravity',
    'branch', v_run.branch,
    'environment', v_run.environment,
    'commitSha', v_run.commit_sha,
    'createdAt', v_run.started_at,
    'cases', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'code', c.code,
          'title', c.title,
          'suite', c.suite,
          'priority', c.priority,
          'tags', c.tags,
          'steps', coalesce(
            (
              select jsonb_agg(
                jsonb_build_object(
                  'n', st.position,
                  'code', st.code,
                  'action', st.action,
                  'expected', st.expected,
                  'precondition', '',
                  'snapshot', st.snapshot
                )
                order by st.position
              )
              from public.test_steps st
              where st.case_id = c.id
            ),
            '[]'::jsonb
          )
        )
        order by c.position, c.code
      ),
      '[]'::jsonb
    )
  )
  into v_manifest
  from public.test_cases c
  where c.plan_id = v_plan.id
    and c.status = 'active'
    and (
      p_case_ids is null
      or cardinality(p_case_ids) = 0
      or c.id = any (p_case_ids)
    );

  if jsonb_array_length(v_manifest->'cases') = 0 then
    raise exception 'NO_CASES_SELECTED';
  end if;

  -- Jeton opaque de 64 caractères hexadécimaux ; seul le hash est conservé.
  v_token := replace(gen_random_uuid()::text, '-', '')
          || replace(gen_random_uuid()::text, '-', '');

  insert into public.ci_run_tokens (run_id, token_hash, expires_at)
  values (
    v_run.id,
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    now() + interval '6 hours'
  );

  update public.test_runs
  set manifest = v_manifest,
      manifest_hash = encode(sha256(convert_to(v_manifest::text, 'UTF8')), 'hex')
  where id = v_run.id;

  return jsonb_build_object(
    'runId', v_run.id,
    'runNumber', v_run_number,
    'token', v_token,
    'expiresAt', now() + interval '6 hours',
    'manifest', v_manifest
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Association du run GitHub (appelée au démarrage du workflow)
-- ---------------------------------------------------------------------------

create or replace function public.attach_github_run(
  p_run_id uuid,
  p_token text,
  p_github_run_id bigint,
  p_github_run_attempt integer,
  p_github_run_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.ci_run_tokens;
begin
  select * into v_token
  from public.ci_run_tokens
  where run_id = p_run_id
    and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and revoked_at is null
    and expires_at > now();

  if not found then
    raise exception 'RUN_TOKEN_INVALID' using errcode = '42501';
  end if;

  update public.test_runs
  set github_run_id = p_github_run_id,
      github_run_attempt = coalesce(p_github_run_attempt, 1),
      github_run_url = p_github_run_url
  where id = p_run_id;

  update public.ci_run_tokens
  set used_at = now()
  where id = v_token.id;

  return jsonb_build_object(
    'runId', p_run_id,
    'githubRunId', p_github_run_id,
    'githubRunAttempt', coalesce(p_github_run_attempt, 1)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Ingestion idempotente des résultats
-- ---------------------------------------------------------------------------

create or replace function public.report_run(
  p_run_id uuid,
  p_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token public.ci_run_tokens;
  v_run public.test_runs;
  v_site public.sites;
  v_case jsonb;
  v_case_id uuid;
  v_result_id uuid;
  v_step jsonb;
  v_step_id uuid;
  v_step_status text;
  v_first_failure text;
  v_discovered boolean;
  v_unknown text[] := array[]::text[];
  v_passed integer;
  v_failed integer;
  v_blocked integer;
  v_skipped integer;
  v_total integer;
  v_status text;
  v_payload_status text := p_payload->>'status';
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'RUN_PAYLOAD_INVALID';
  end if;

  select * into v_token
  from public.ci_run_tokens
  where run_id = p_run_id
    and token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and revoked_at is null
    and expires_at > now();

  if not found then
    raise exception 'RUN_TOKEN_INVALID' using errcode = '42501';
  end if;

  select * into v_run
  from public.test_runs
  where id = p_run_id;

  if not found then
    raise exception 'RUN_NOT_FOUND';
  end if;

  select * into v_site
  from public.sites
  where id = v_run.site_id;

  update public.test_runs
  set github_run_id = coalesce((p_payload->>'github_run_id')::bigint, github_run_id),
      github_run_attempt = coalesce((p_payload->>'github_run_attempt')::integer, github_run_attempt),
      github_run_url = coalesce(nullif(p_payload->>'github_run_url', ''), github_run_url),
      model = coalesce(nullif(p_payload->>'model', ''), model)
  where id = p_run_id;

  for v_case in
    select value from jsonb_array_elements(
      case
        when jsonb_typeof(p_payload->'cases') = 'array' then p_payload->'cases'
        else '[]'::jsonb
      end
    )
  loop
    if nullif(v_case->>'code', '') is null then
      v_unknown := array_append(v_unknown, '?');
      continue;
    end if;

    v_case_id := null;

    select c.id into v_case_id
    from public.test_cases c
    where c.plan_id = v_run.plan_id
      and c.code = v_case->>'code';

    v_discovered := coalesce((v_case->>'discovered')::boolean, false);

    -- Cas ajouté par l'agent pendant l'exploration (TC-1xx) : on l'incorpore au
    -- plan pour qu'il apparaisse dans la liste des cas et dans le détail du run.
    if v_case_id is null and v_discovered then
      insert into public.test_cases (
        plan_id, code, position, title, suite, status, priority,
        tags, description, source, entry_url, coverage_status,
        preconditions, postconditions, observations
      )
      values (
        v_run.plan_id,
        v_case->>'code',
        (
          select coalesce(max(c.position), 0) + 1
          from public.test_cases c
          where c.plan_id = v_run.plan_id
        ),
        coalesce(nullif(v_case->>'title', ''), v_case->>'code'),
        coalesce(nullif(v_case->>'suite', ''), nullif(v_case->>'category', ''), 'Découvertes'),
        'active',
        case v_case->>'severity'
          when 'P0' then 'critical'
          when 'P1' then 'high'
          when 'P2' then 'medium'
          else 'low'
        end,
        array['@discovered'] || case
          when nullif(v_case->>'category', '') is not null
            then array['@' || (v_case->>'category')]
          else array[]::text[]
        end,
        v_case->>'description',
        'discovered',
        v_site.site_url,
        'discovered',
        '{}'::text[],
        null,
        '[]'::jsonb
      )
      on conflict (plan_id, code) do update set
        title = excluded.title,
        suite = excluded.suite,
        description = excluded.description
      returning id into v_case_id;
    end if;

    if v_case_id is null then
      v_unknown := array_append(v_unknown, coalesce(v_case->>'code', '?'));
      continue;
    end if;

    -- Les étapes d'un cas découvert n'existent pas dans le plan : on les crée
    -- (ou on les met à jour si l'agent les a précisées lors d'un rejeu).
    if v_discovered then
      for v_step in
        select value from jsonb_array_elements(
          case
            when jsonb_typeof(v_case->'steps') = 'array' then v_case->'steps'
            else '[]'::jsonb
          end
        )
      loop
        insert into public.test_steps (case_id, position, code, action, expected, snapshot)
        values (
          v_case_id,
          coalesce(nullif(v_step->>'n', '')::integer, 1),
          coalesce(nullif(v_step->>'code', ''), 'S' || coalesce(v_step->>'n', '1')),
          coalesce(nullif(v_step->>'action', ''), 'Action non renseignée'),
          coalesce(nullif(v_step->>'expected', ''), 'Attendu non renseigné'),
          null
        )
        on conflict (case_id, position) do update set
          code = excluded.code,
          action = excluded.action,
          expected = excluded.expected;
      end loop;
    end if;

    -- Premier échec observé, utilisé comme message de synthèse du cas.
    select s.value->>'actual' into v_first_failure
    from jsonb_array_elements(
      case
        when jsonb_typeof(v_case->'steps') = 'array' then v_case->'steps'
        else '[]'::jsonb
      end
    ) with ordinality as s(value, ord)
    where s.value->>'status' = 'failed'
    order by s.ord
    limit 1;

    insert into public.test_case_results (
      run_id, case_id, status, note, duration_ms,
      failure_message, stack_trace, retry_count,
      started_at, finished_at, artifacts, severity
    )
    values (
      p_run_id,
      v_case_id,
      case
        when v_case->>'status' in ('passed', 'failed', 'blocked', 'skipped')
          then v_case->>'status'
        else 'failed'
      end,
      v_case->>'note',
      nullif(v_case->>'duration_ms', '')::integer,
      coalesce(nullif(v_case->>'failure_message', ''), v_first_failure),
      v_case->>'stack_trace',
      coalesce(nullif(v_case->>'retry_count', '')::integer, 0),
      nullif(v_case->>'started_at', '')::timestamptz,
      nullif(v_case->>'finished_at', '')::timestamptz,
      case
        when jsonb_typeof(v_case->'artifacts') = 'array' then v_case->'artifacts'
        else '[]'::jsonb
      end,
      case
        when v_case->>'severity' in ('P0', 'P1', 'P2') then v_case->>'severity'
        else null
      end
    )
    on conflict (run_id, case_id) do update set
      status = excluded.status,
      note = excluded.note,
      duration_ms = excluded.duration_ms,
      failure_message = excluded.failure_message,
      stack_trace = excluded.stack_trace,
      retry_count = excluded.retry_count,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      artifacts = excluded.artifacts,
      severity = excluded.severity
    returning id into v_result_id;

    delete from public.test_step_results
    where case_result_id = v_result_id;

    for v_step in
      select value from jsonb_array_elements(
        case
          when jsonb_typeof(v_case->'steps') = 'array' then v_case->'steps'
          else '[]'::jsonb
        end
      )
    loop
      v_step_id := null;

      -- qa_result.json numérote les étapes avec `n` ; on retombe sur `code`
      -- pour les anciens rapports.
      select st.id into v_step_id
      from public.test_steps st
      where st.case_id = v_case_id
        and (
          st.position = nullif(v_step->>'n', '')::integer
          or (
            nullif(v_step->>'n', '') is null
            and st.code = v_step->>'code'
          )
        )
      limit 1;

      if v_step_id is null then
        continue;
      end if;

      v_step_status := case
        when v_step->>'status' in ('passed', 'failed', 'blocked', 'skipped')
          then v_step->>'status'
        else 'failed'
      end;

      insert into public.test_step_results (
        case_result_id, step_id, status, actual, evidence_url, precondition, evidence
      )
      values (
        v_result_id,
        v_step_id,
        v_step_status,
        coalesce(nullif(v_step->>'actual', ''), 'non renseigné'),
        coalesce(
          nullif(v_step->'evidence'->>'screenshot', ''),
          nullif(v_step->'evidence'->>'url', '')
        ),
        nullif(v_step->>'precondition', ''),
        case
          when jsonb_typeof(v_step->'evidence') = 'object' then v_step->'evidence'
          else '{}'::jsonb
        end
      )
      on conflict (case_result_id, step_id) do update set
        status = excluded.status,
        actual = excluded.actual,
        evidence_url = excluded.evidence_url,
        precondition = excluded.precondition,
        evidence = excluded.evidence;
    end loop;
  end loop;

  -- Tout cas du manifeste non rapporté est bloqué : le total du run correspond
  -- ainsi exactement aux cas sélectionnés, même si l'agent en omet.
  insert into public.test_case_results (
    run_id, case_id, status, note, failure_message
  )
  select
    p_run_id,
    c.id,
    'blocked',
    'Non exécuté',
    'Le cas figurait dans le manifeste mais n''a pas été rapporté par l''agent.'
  from jsonb_array_elements(
    case
      when jsonb_typeof(v_run.manifest->'cases') = 'array' then v_run.manifest->'cases'
      else '[]'::jsonb
    end
  ) m
  join public.test_cases c
    on c.plan_id = v_run.plan_id
   and c.code = m->>'code'
  where not exists (
    select 1
    from public.test_case_results r
    where r.run_id = p_run_id
      and r.case_id = c.id
  );

  select
    (count(*) filter (where status = 'passed'))::integer,
    (count(*) filter (where status = 'failed'))::integer,
    (count(*) filter (where status = 'blocked'))::integer,
    (count(*) filter (where status = 'skipped'))::integer,
    count(*)::integer
  into v_passed, v_failed, v_blocked, v_skipped, v_total
  from public.test_case_results
  where run_id = p_run_id;

  v_status := case
    when v_payload_status = 'error' then 'error'
    when v_payload_status = 'cancelled' then 'cancelled'
    when v_payload_status = 'failed' then 'failed'
    when v_failed > 0 or v_blocked > 0 then 'failed'
    when v_total = 0 then 'error'
    when v_passed = 0 then 'failed'
    else 'passed'
  end;

  update public.test_runs
  set status = v_status,
      finished_at = now(),
      duration_ms = coalesce(
        nullif(p_payload->>'duration_ms', '')::integer,
        greatest(0, (extract(epoch from (now() - v_run.started_at)) * 1000)::integer)
      ),
      passed_count = v_passed,
      failed_count = v_failed,
      blocked_count = v_blocked,
      skipped_count = v_skipped,
      total_count = v_total,
      report = p_payload,
      error_message = p_payload->>'error_message',
      model = coalesce(nullif(p_payload->>'model', ''), model),
      executor = coalesce(nullif(p_payload->>'executor', ''), executor),
      side_effects = case
        when jsonb_typeof(p_payload->'side_effects') = 'array' then p_payload->'side_effects'
        else '[]'::jsonb
      end
  where id = p_run_id;

  update public.ci_run_tokens
  set used_at = now()
  where id = v_token.id;

  return jsonb_build_object(
    'runId', p_run_id,
    'status', v_status,
    'passed', v_passed,
    'failed', v_failed,
    'blocked', v_blocked,
    'skipped', v_skipped,
    'total', v_total,
    'unknownCases', v_unknown
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Droits : service_role uniquement
-- ---------------------------------------------------------------------------

revoke all on function public.create_run_manifest(uuid, uuid[], text, text, text, text, text, text, integer, text[]) from public;
revoke all on function public.attach_github_run(uuid, text, bigint, integer, text) from public;
revoke all on function public.report_run(uuid, text, jsonb) from public;

revoke all on function public.create_run_manifest(uuid, uuid[], text, text, text, text, text, text, integer, text[]) from anon, authenticated;
revoke all on function public.attach_github_run(uuid, text, bigint, integer, text) from anon, authenticated;
revoke all on function public.report_run(uuid, text, jsonb) from anon, authenticated;

grant execute on function public.create_run_manifest(uuid, uuid[], text, text, text, text, text, text, integer, text[]) to service_role;
grant execute on function public.attach_github_run(uuid, text, bigint, integer, text) to service_role;
grant execute on function public.report_run(uuid, text, jsonb) to service_role;
