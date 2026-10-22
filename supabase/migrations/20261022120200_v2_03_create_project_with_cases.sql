-- ============================================================================
-- V2 — 03 — Création / modification / suppression atomiques d'un projet
--
-- La création ne reçoit AUCUN cas de test du client : le serveur choisit le
-- modèle correspondant à la catégorie, crée le plan v1 actif, puis copie les
-- cas et leurs étapes. Un seul COMMIT : pas de skeleton sur des inserts partiels.
-- ============================================================================

create or replace function public.create_project_with_cases(
  p_org_id uuid,
  p_name text,
  p_client_name text,
  p_site_url text,
  p_category text,
  p_description text default null,
  p_assignee text default null,
  p_frequency_hours integer default 24,
  p_notification_hours integer default 12
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_client text := btrim(coalesce(p_client_name, ''));
  v_url text := btrim(coalesce(p_site_url, ''));
  v_category text := coalesce(nullif(btrim(p_category), ''), 'Autre');
  v_frequency integer := coalesce(p_frequency_hours, 24);
  v_notification integer := coalesce(p_notification_hours, 12);
  v_base text;
  v_slug text;
  v_suffix integer := 2;
  v_site public.sites;
  v_plan public.test_plans;
  v_cases integer := 0;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if not public.has_org_role(p_org_id, array['owner', 'admin', 'member']) then
    raise exception 'ORG_FORBIDDEN' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'PROJECT_NAME_REQUIRED';
  end if;

  if v_client = '' then
    raise exception 'CLIENT_NAME_REQUIRED';
  end if;

  if v_url !~* '^https?://' then
    raise exception 'PROJECT_URL_INVALID';
  end if;

  if v_frequency < 1 or v_notification < 1 then
    raise exception 'FREQUENCY_INVALID';
  end if;

  -- Catégorie inconnue : on retombe sur le pack générique s'il existe.
  if not exists (
    select 1 from public.case_templates t
    where t.category = v_category and t.is_active
  ) then
    if exists (
      select 1 from public.case_templates t
      where t.category = 'Autre' and t.is_active
    ) then
      v_category := 'Autre';
    else
      raise exception 'NO_CASE_TEMPLATES';
    end if;
  end if;

  -- Slug calculé côté serveur, jamais fourni par le client.
  v_base := public.slugify(v_name);
  if lower(v_base) = 'demoproject' then
    v_base := v_base || '-projet';
  end if;

  v_slug := v_base;
  while exists (
    select 1 from public.sites s where lower(s.slug) = lower(v_slug)
  ) loop
    v_slug := v_base || '-' || v_suffix;
    v_suffix := v_suffix + 1;
  end loop;

  insert into public.sites (
    org_id, name, slug, category, description,
    client_name, site_url, assignee,
    is_active, crawl_interval_minutes, notification_interval_minutes
  )
  values (
    p_org_id, v_name, v_slug, v_category,
    nullif(btrim(coalesce(p_description, '')), ''),
    v_client, v_url,
    nullif(btrim(coalesce(p_assignee, '')), ''),
    true, v_frequency * 60, v_notification * 60
  )
  returning * into v_site;

  -- Plan v1 actif : l'index partiel one_active_plan_per_site garantit l'unicité.
  insert into public.test_plans (
    site_id, version, status, site_type, interactions_mode,
    playbook_coverage, generated_at
  )
  values (
    v_site.id, 1, 'active', v_category, 'full',
    '[]'::jsonb, now()
  )
  returning * into v_plan;

  insert into public.test_cases (
    plan_id, code, position, title, suite, status, priority,
    tags, description, source, entry_url, preconditions,
    postconditions, observations
  )
  select
    v_plan.id,
    t.code,
    t.position,
    t.title,
    t.suite,
    'active',
    t.priority,
    t.tags,
    t.description,
    'template',
    v_site.site_url,
    t.preconditions,
    t.postconditions,
    '[]'::jsonb
  from public.case_templates t
  where t.category = v_category
    and t.is_active
  order by t.position, t.code;

  get diagnostics v_cases = row_count;

  insert into public.test_steps (case_id, position, code, action, expected, snapshot)
  select
    c.id,
    s.ord::integer,
    coalesce(nullif(s.value->>'code', ''), 'S' || s.ord),
    coalesce(s.value->>'action', ''),
    coalesce(s.value->>'expected', ''),
    null
  from public.test_cases c
  join public.case_templates t
    on t.category = v_category
   and t.code = c.code
  cross join lateral jsonb_array_elements(t.steps) with ordinality as s(value, ord)
  where c.plan_id = v_plan.id
  order by c.position, s.ord;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', v_site.id,
      'slug', v_site.slug,
      'name', v_site.name,
      'category', v_site.category,
      'description', v_site.description,
      'clientName', v_site.client_name,
      'url', v_site.site_url,
      'assignee', v_site.assignee,
      'frequency', v_frequency,
      'notificationFrequency', v_notification,
      'createdAt', v_site.created_at
    ),
    'planId', v_plan.id,
    'caseCount', v_cases
  );
end;
$$;

create or replace function public.update_project(
  p_site_id uuid,
  p_name text,
  p_client_name text,
  p_site_url text,
  p_category text,
  p_description text default null,
  p_assignee text default null,
  p_frequency_hours integer default 24,
  p_notification_hours integer default 12
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_site public.sites;
  v_name text := btrim(coalesce(p_name, ''));
  v_client text := btrim(coalesce(p_client_name, ''));
  v_url text := btrim(coalesce(p_site_url, ''));
  v_category text := coalesce(nullif(btrim(p_category), ''), 'Autre');
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select org_id into v_org_id
  from public.sites
  where id = p_site_id and org_id is not null;

  if v_org_id is null then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if not public.has_org_role(v_org_id, array['owner', 'admin']) then
    raise exception 'ORG_FORBIDDEN' using errcode = '42501';
  end if;

  if v_name = '' or v_client = '' then
    raise exception 'PROJECT_FIELDS_REQUIRED';
  end if;

  if v_url !~* '^https?://' then
    raise exception 'PROJECT_URL_INVALID';
  end if;

  if coalesce(p_frequency_hours, 0) < 1 or coalesce(p_notification_hours, 0) < 1 then
    raise exception 'FREQUENCY_INVALID';
  end if;

  update public.sites
  set name = v_name,
      client_name = v_client,
      site_url = v_url,
      category = v_category,
      description = nullif(btrim(coalesce(p_description, '')), ''),
      assignee = nullif(btrim(coalesce(p_assignee, '')), ''),
      crawl_interval_minutes = p_frequency_hours * 60,
      notification_interval_minutes = p_notification_hours * 60
  where id = p_site_id
  returning * into v_site;

  -- Le plan actif suit la catégorie, mais les cas déjà copiés ne sont pas
  -- remplacés silencieusement : un changement de pack doit rester explicite.
  update public.test_plans
  set site_type = v_category
  where site_id = p_site_id and status = 'active';

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', v_site.id,
      'slug', v_site.slug,
      'name', v_site.name,
      'category', v_site.category,
      'description', v_site.description,
      'clientName', v_site.client_name,
      'url', v_site.site_url,
      'assignee', v_site.assignee,
      'frequency', p_frequency_hours,
      'notificationFrequency', p_notification_hours,
      'createdAt', v_site.created_at
    )
  );
end;
$$;

create or replace function public.delete_project(p_site_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select org_id into v_org_id
  from public.sites
  where id = p_site_id and org_id is not null;

  if v_org_id is null then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if not public.has_org_role(v_org_id, array['owner', 'admin']) then
    raise exception 'ORG_FORBIDDEN' using errcode = '42501';
  end if;

  delete from public.sites where id = p_site_id;
end;
$$;

revoke all on function public.create_project_with_cases(uuid, text, text, text, text, text, text, integer, integer) from public;
revoke all on function public.update_project(uuid, text, text, text, text, text, text, integer, integer) from public;
revoke all on function public.delete_project(uuid) from public;

grant execute on function public.create_project_with_cases(uuid, text, text, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.update_project(uuid, text, text, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.delete_project(uuid) to authenticated;
