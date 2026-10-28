-- ============================================================================
-- V2 — 13 — Profil de site et enrichissement des cas
--
-- L'exploration d'un site est faite une fois, puis renouvelée chaque semaine.
-- Le profil ne contient que des faits observés (produits, prix, tri, recherche,
-- vendeurs) avec leur preuve. Les cas enrichis en sont dérivés : ils ne
-- modifient pas le contenu rédigé, ils s'y superposent.
--
-- `enrichments` garde, par code de cas, les étapes concrètes produites à partir
-- du profil. Une nouvelle exploration remplace l'ensemble : rien à migrer.
-- ============================================================================

create table if not exists public.site_profiles (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null unique references public.sites(id) on delete cascade,
  version integer not null default 1,
  captured_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  source text not null default 'crawler'
    check (source in ('crawler', 'llm', 'hybrid')),
  status text not null default 'ready'
    check (status in ('ready', 'partial', 'failed')),
  profile jsonb not null default '{}'::jsonb,
  enrichments jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_profiles_expires_idx
  on public.site_profiles (expires_at);

drop trigger if exists site_profiles_touch on public.site_profiles;
create trigger site_profiles_touch
  before update on public.site_profiles
  for each row execute function public.touch_updated_at();

alter table public.site_profiles enable row level security;

-- Lecture par les membres de l'organisation propriétaire du site.
drop policy if exists site_profiles_select_member on public.site_profiles;
create policy site_profiles_select_member
  on public.site_profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.sites s
      where s.id = site_profiles.site_id
        and s.org_id is not null
        and public.is_org_member(s.org_id)
    )
  );

-- Aucune policy d'écriture : seul le service role (fonctions Edge) écrit.
revoke insert, update, delete on public.site_profiles from authenticated, anon;
grant select on public.site_profiles to authenticated;

comment on table public.site_profiles is
  'Profil factuel du site (exploration hebdomadaire) et cas enrichis dérivés.';
