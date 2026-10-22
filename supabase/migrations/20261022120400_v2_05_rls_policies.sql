-- ============================================================================
-- V2 — 05 — Row Level Security par organisation
--
-- Toutes les tables avaient déjà RLS activé mais AUCUNE policy : seul le
-- service_role pouvait lire/écrire. On ouvre maintenant l'accès aux membres
-- de l'organisation, avec des helpers SECURITY DEFINER pour éviter les
-- récursions et les jointures RLS en cascade.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers d'accès
-- ---------------------------------------------------------------------------

create or replace function public.can_access_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.sites s
    where s.id = p_site_id
      and s.org_id is not null
      and public.is_org_member(s.org_id)
  );
$$;

create or replace function public.can_manage_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.sites s
    where s.id = p_site_id
      and s.org_id is not null
      and public.has_org_role(s.org_id, array['owner', 'admin'])
  );
$$;

create or replace function public.can_access_page(p_page_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.pages p
    where p.id = p_page_id
      and public.can_access_site(p.site_id)
  );
$$;

create or replace function public.can_manage_page(p_page_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.pages p
    where p.id = p_page_id
      and public.can_manage_site(p.site_id)
  );
$$;

create or replace function public.can_access_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.test_plans p
    where p.id = p_plan_id
      and public.can_access_site(p.site_id)
  );
$$;

create or replace function public.can_manage_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.test_plans p
    where p.id = p_plan_id
      and public.can_manage_site(p.site_id)
  );
$$;

create or replace function public.can_access_case(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.test_cases c
    where c.id = p_case_id
      and public.can_access_plan(c.plan_id)
  );
$$;

create or replace function public.can_manage_case(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.test_cases c
    where c.id = p_case_id
      and public.can_manage_plan(c.plan_id)
  );
$$;

create or replace function public.can_access_run(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.test_runs r
    where r.id = p_run_id
      and public.can_access_site(r.site_id)
  );
$$;

create or replace function public.can_manage_run(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.test_runs r
    where r.id = p_run_id
      and public.can_manage_site(r.site_id)
  );
$$;

create or replace function public.can_access_case_result(p_case_result_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.test_case_results r
    where r.id = p_case_result_id
      and public.can_access_run(r.run_id)
  );
$$;

revoke all on function public.can_access_site(uuid) from public;
revoke all on function public.can_manage_site(uuid) from public;
revoke all on function public.can_access_page(uuid) from public;
revoke all on function public.can_manage_page(uuid) from public;
revoke all on function public.can_access_plan(uuid) from public;
revoke all on function public.can_manage_plan(uuid) from public;
revoke all on function public.can_access_case(uuid) from public;
revoke all on function public.can_manage_case(uuid) from public;
revoke all on function public.can_access_run(uuid) from public;
revoke all on function public.can_manage_run(uuid) from public;
revoke all on function public.can_access_case_result(uuid) from public;

grant execute on function public.can_access_site(uuid) to authenticated;
grant execute on function public.can_manage_site(uuid) to authenticated;
grant execute on function public.can_access_page(uuid) to authenticated;
grant execute on function public.can_manage_page(uuid) to authenticated;
grant execute on function public.can_access_plan(uuid) to authenticated;
grant execute on function public.can_manage_plan(uuid) to authenticated;
grant execute on function public.can_access_case(uuid) to authenticated;
grant execute on function public.can_manage_case(uuid) to authenticated;
grant execute on function public.can_access_run(uuid) to authenticated;
grant execute on function public.can_manage_run(uuid) to authenticated;
grant execute on function public.can_access_case_result(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Activation RLS (idempotent)
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.sites enable row level security;
alter table public.pages enable row level security;
alter table public.page_checks enable row level security;
alter table public.crawl_reports enable row level security;
alter table public.test_plans enable row level security;
alter table public.test_cases enable row level security;
alter table public.test_steps enable row level security;
alter table public.test_runs enable row level security;
alter table public.test_case_results enable row level security;
alter table public.test_step_results enable row level security;
alter table public.case_templates enable row level security;
alter table public.github_integrations enable row level security;
alter table public.ci_run_tokens enable row level security;
alter table public.run_acknowledgements enable row level security;

-- ---------------------------------------------------------------------------
-- Organisations et membres
-- ---------------------------------------------------------------------------

drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member
  on public.organizations for select to authenticated
  using (public.is_org_member(id));

drop policy if exists organizations_update_admin on public.organizations;
create policy organizations_update_admin
  on public.organizations for update to authenticated
  using (public.has_org_role(id, array['owner', 'admin']))
  with check (public.has_org_role(id, array['owner', 'admin']));

drop policy if exists organizations_delete_owner on public.organizations;
create policy organizations_delete_owner
  on public.organizations for delete to authenticated
  using (public.has_org_role(id, array['owner']));

drop policy if exists organization_members_select on public.organization_members;
create policy organization_members_select
  on public.organization_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_org_member(org_id));

drop policy if exists organization_members_insert_admin on public.organization_members;
create policy organization_members_insert_admin
  on public.organization_members for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'admin']));

drop policy if exists organization_members_update_admin on public.organization_members;
create policy organization_members_update_admin
  on public.organization_members for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']))
  with check (public.has_org_role(org_id, array['owner', 'admin']));

drop policy if exists organization_members_delete on public.organization_members;
create policy organization_members_delete
  on public.organization_members for delete to authenticated
  using (
    public.has_org_role(org_id, array['owner', 'admin'])
    or user_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Projets (sites) et monitoring
-- ---------------------------------------------------------------------------

drop policy if exists sites_select_member on public.sites;
create policy sites_select_member
  on public.sites for select to authenticated
  using (org_id is not null and public.is_org_member(org_id));

-- Pas de policy INSERT : la création passe exclusivement par
-- create_project_with_cases() (SECURITY DEFINER), pour garantir la copie
-- atomique des cas et empêcher un projet sans pack.

drop policy if exists sites_update_admin on public.sites;
create policy sites_update_admin
  on public.sites for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']))
  with check (public.has_org_role(org_id, array['owner', 'admin']));

drop policy if exists sites_delete_admin on public.sites;
create policy sites_delete_admin
  on public.sites for delete to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']));

drop policy if exists pages_select_member on public.pages;
create policy pages_select_member
  on public.pages for select to authenticated
  using (public.can_access_site(site_id));

drop policy if exists pages_insert_admin on public.pages;
create policy pages_insert_admin
  on public.pages for insert to authenticated
  with check (public.can_manage_site(site_id));

drop policy if exists pages_update_admin on public.pages;
create policy pages_update_admin
  on public.pages for update to authenticated
  using (public.can_manage_page(id))
  with check (public.can_manage_site(site_id));

drop policy if exists pages_delete_admin on public.pages;
create policy pages_delete_admin
  on public.pages for delete to authenticated
  using (public.can_manage_page(id));

drop policy if exists page_checks_select_member on public.page_checks;
create policy page_checks_select_member
  on public.page_checks for select to authenticated
  using (public.can_access_page(page_id));

drop policy if exists page_checks_insert_admin on public.page_checks;
create policy page_checks_insert_admin
  on public.page_checks for insert to authenticated
  with check (public.can_manage_page(page_id));

drop policy if exists page_checks_update_admin on public.page_checks;
create policy page_checks_update_admin
  on public.page_checks for update to authenticated
  using (public.can_manage_page(page_id))
  with check (public.can_manage_page(page_id));

drop policy if exists page_checks_delete_admin on public.page_checks;
create policy page_checks_delete_admin
  on public.page_checks for delete to authenticated
  using (public.can_manage_page(page_id));

drop policy if exists crawl_reports_select_member on public.crawl_reports;
create policy crawl_reports_select_member
  on public.crawl_reports for select to authenticated
  using (public.can_access_site(site_id));

drop policy if exists crawl_reports_insert_admin on public.crawl_reports;
create policy crawl_reports_insert_admin
  on public.crawl_reports for insert to authenticated
  with check (public.can_manage_site(site_id));

drop policy if exists crawl_reports_update_admin on public.crawl_reports;
create policy crawl_reports_update_admin
  on public.crawl_reports for update to authenticated
  using (public.can_manage_site(site_id))
  with check (public.can_manage_site(site_id));

drop policy if exists crawl_reports_delete_admin on public.crawl_reports;
create policy crawl_reports_delete_admin
  on public.crawl_reports for delete to authenticated
  using (public.can_manage_site(site_id));

-- ---------------------------------------------------------------------------
-- Plans, cas et étapes
-- ---------------------------------------------------------------------------

drop policy if exists test_plans_select_member on public.test_plans;
create policy test_plans_select_member
  on public.test_plans for select to authenticated
  using (public.can_access_site(site_id));

-- Pas de policy INSERT : la création du plan et la copie des cas sont faites
-- par create_project_with_cases().

drop policy if exists test_plans_update_admin on public.test_plans;
create policy test_plans_update_admin
  on public.test_plans for update to authenticated
  using (public.can_manage_plan(id))
  with check (public.can_manage_site(site_id));

drop policy if exists test_plans_delete_admin on public.test_plans;
create policy test_plans_delete_admin
  on public.test_plans for delete to authenticated
  using (public.can_manage_plan(id));

drop policy if exists test_cases_select_member on public.test_cases;
create policy test_cases_select_member
  on public.test_cases for select to authenticated
  using (public.can_access_plan(plan_id));

drop policy if exists test_cases_insert_admin on public.test_cases;
create policy test_cases_insert_admin
  on public.test_cases for insert to authenticated
  with check (public.can_manage_plan(plan_id));

drop policy if exists test_cases_update_admin on public.test_cases;
create policy test_cases_update_admin
  on public.test_cases for update to authenticated
  using (public.can_manage_case(id))
  with check (public.can_manage_plan(plan_id));

drop policy if exists test_cases_delete_admin on public.test_cases;
create policy test_cases_delete_admin
  on public.test_cases for delete to authenticated
  using (public.can_manage_case(id));

drop policy if exists test_steps_select_member on public.test_steps;
create policy test_steps_select_member
  on public.test_steps for select to authenticated
  using (public.can_access_case(case_id));

drop policy if exists test_steps_insert_admin on public.test_steps;
create policy test_steps_insert_admin
  on public.test_steps for insert to authenticated
  with check (public.can_manage_case(case_id));

drop policy if exists test_steps_update_admin on public.test_steps;
create policy test_steps_update_admin
  on public.test_steps for update to authenticated
  using (public.can_manage_case(case_id))
  with check (public.can_manage_case(case_id));

drop policy if exists test_steps_delete_admin on public.test_steps;
create policy test_steps_delete_admin
  on public.test_steps for delete to authenticated
  using (public.can_manage_case(case_id));

-- ---------------------------------------------------------------------------
-- Exécutions et résultats
-- ---------------------------------------------------------------------------

drop policy if exists test_runs_select_member on public.test_runs;
create policy test_runs_select_member
  on public.test_runs for select to authenticated
  using (public.can_access_site(site_id));

-- Pas de policy INSERT : un run est créé par create_run_manifest() via l'Edge
-- Function start-run. Le navigateur ne peut donc pas forger un run ni un jeton.

drop policy if exists test_runs_update_admin on public.test_runs;
create policy test_runs_update_admin
  on public.test_runs for update to authenticated
  using (public.can_manage_run(id))
  with check (public.can_manage_site(site_id));

drop policy if exists test_runs_delete_admin on public.test_runs;
create policy test_runs_delete_admin
  on public.test_runs for delete to authenticated
  using (public.can_manage_run(id));

drop policy if exists test_case_results_select_member on public.test_case_results;
create policy test_case_results_select_member
  on public.test_case_results for select to authenticated
  using (public.can_access_run(run_id));

drop policy if exists test_step_results_select_member on public.test_step_results;
create policy test_step_results_select_member
  on public.test_step_results for select to authenticated
  using (public.can_access_case_result(case_result_id));

-- ---------------------------------------------------------------------------
-- Modèles, intégration GitHub, jetons, acquittements
-- ---------------------------------------------------------------------------

drop policy if exists case_templates_select_authenticated on public.case_templates;
create policy case_templates_select_authenticated
  on public.case_templates for select to authenticated
  using (is_active);

drop policy if exists github_integrations_select_member on public.github_integrations;
create policy github_integrations_select_member
  on public.github_integrations for select to authenticated
  using (public.is_org_member(org_id));

drop policy if exists github_integrations_insert_admin on public.github_integrations;
create policy github_integrations_insert_admin
  on public.github_integrations for insert to authenticated
  with check (public.has_org_role(org_id, array['owner', 'admin']));

drop policy if exists github_integrations_update_admin on public.github_integrations;
create policy github_integrations_update_admin
  on public.github_integrations for update to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']))
  with check (public.has_org_role(org_id, array['owner', 'admin']));

drop policy if exists github_integrations_delete_admin on public.github_integrations;
create policy github_integrations_delete_admin
  on public.github_integrations for delete to authenticated
  using (public.has_org_role(org_id, array['owner', 'admin']));

-- ci_run_tokens : volontairement aucune policy. Seul le service_role y accède.

drop policy if exists run_acknowledgements_select_self on public.run_acknowledgements;
create policy run_acknowledgements_select_self
  on public.run_acknowledgements for select to authenticated
  using (user_id = (select auth.uid()) and public.can_access_run(run_id));

drop policy if exists run_acknowledgements_insert_self on public.run_acknowledgements;
create policy run_acknowledgements_insert_self
  on public.run_acknowledgements for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_access_run(run_id));

drop policy if exists run_acknowledgements_delete_self on public.run_acknowledgements;
create policy run_acknowledgements_delete_self
  on public.run_acknowledgements for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Droits de table (RLS reste le filtre réel)
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;

grant select, update, delete on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;

grant select, update, delete on public.sites to authenticated;
grant select, insert, update, delete on public.pages to authenticated;
grant select, insert, update, delete on public.page_checks to authenticated;
grant select, insert, update, delete on public.crawl_reports to authenticated;

grant select, update, delete on public.test_plans to authenticated;
grant select, insert, update, delete on public.test_cases to authenticated;
grant select, insert, update, delete on public.test_steps to authenticated;
grant select, update, delete on public.test_runs to authenticated;
grant select on public.test_case_results to authenticated;
grant select on public.test_step_results to authenticated;

grant select on public.case_templates to authenticated;
grant select, insert, update, delete on public.github_integrations to authenticated;
grant select, insert, delete on public.run_acknowledgements to authenticated;

-- ci_run_tokens n'est accordé à aucun rôle client.
