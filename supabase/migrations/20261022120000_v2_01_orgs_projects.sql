-- ============================================================================
-- V2 — 01 — Organisations, appartenance et champs « projet » sur sites
--
-- Principe : `sites` reste la racine (un projet = un site suivi). Les sites
-- historiques du monitoring ont org_id/slug/name NULL et ne sont pas exposés
-- au clone. Les projets créés par l'application ont les trois champs renseignés.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Fonctions utilitaires
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Translittération simple (sans l'extension unaccent), utilisée pour les slugs.
create or replace function public.slugify(p_text text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      trim(both '-' from regexp_replace(
        translate(
          lower(coalesce(p_text, '')),
          'àáâäãåçèéêëìíîïñòóôöõùúûüýÿ',
          'aaaaaaceeeeiiiinooooouuuuyy'
        ),
        '[^a-z0-9]+', '-', 'g'
      )),
      ''
    ),
    'project'
  );
$$;

-- ---------------------------------------------------------------------------
-- Organisations et membres
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  plan text not null default 'free' check (plan in ('free', 'team')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_key unique (slug)
);

create table if not exists public.organization_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists organization_members_user_idx
  on public.organization_members (user_id);

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute function public.touch_updated_at();

-- SECURITY DEFINER : évite la récursion des policies sur organization_members.
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.role = any (p_roles)
  );
$$;

-- Création d'une organisation + adhésion « owner » en une transaction.
-- L'insertion directe dans organizations reste fermée aux clients.
create or replace function public.create_organization(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text;
  v_org public.organizations;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if v_name = '' then
    raise exception 'ORG_NAME_REQUIRED';
  end if;

  v_slug := public.slugify(v_name);
  if exists (select 1 from public.organizations o where o.slug = v_slug) then
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.organizations (name, slug)
  values (v_name, v_slug)
  returning * into v_org;

  insert into public.organization_members (org_id, user_id, role)
  values (v_org.id, v_user, 'owner');

  return jsonb_build_object(
    'id', v_org.id,
    'name', v_org.name,
    'slug', v_org.slug,
    'plan', v_org.plan,
    'createdAt', v_org.created_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Champs projet sur sites
-- ---------------------------------------------------------------------------

alter table public.sites
  add column if not exists org_id uuid,
  add column if not exists name text,
  add column if not exists slug text,
  add column if not exists category text,
  add column if not exists description text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.sites
  add constraint sites_org_id_fkey
    foreign key (org_id) references public.organizations(id) on delete restrict,
  add constraint sites_slug_reserved_demo
    check (slug is null or lower(slug) <> 'demoproject'),
  add constraint sites_project_fields_chk
    check (
      (org_id is null and slug is null and name is null)
      or (org_id is not null and slug is not null and name is not null)
    );

create unique index if not exists sites_slug_lower_key
  on public.sites (lower(slug))
  where slug is not null;

create index if not exists sites_org_id_idx
  on public.sites (org_id);

drop trigger if exists trg_sites_updated_at on public.sites;
create trigger trg_sites_updated_at
  before update on public.sites
  for each row execute function public.touch_updated_at();

comment on column public.sites.org_id is
  'Organisation propriétaire. NULL = site de monitoring historique, hors périmètre du clone.';
comment on column public.sites.slug is
  'Identifiant lisible du projet dans les URLs. DemoProject est réservé à la démo statique.';

-- ---------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, text[]) from public;
revoke all on function public.create_organization(text) from public;
revoke all on function public.slugify(text) from public;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;
grant execute on function public.create_organization(text) to authenticated;
grant execute on function public.slugify(text) to authenticated;
