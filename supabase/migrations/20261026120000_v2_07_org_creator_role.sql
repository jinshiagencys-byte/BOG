-- ============================================================================
-- V2 — 07 — Rôle choisi par le créateur de l'organisation
--
-- L'écran d'onboarding demande désormais le rôle du premier membre. La fonction
-- accepte 'owner', 'admin' ou 'member' et l'applique à l'adhésion créée.
--
-- Le paramètre `p_role` est optionnel (défaut : 'owner') pour rester compatible
-- avec les appels existants. L'ancienne signature à un paramètre est supprimée
-- afin d'éviter une ambiguïté de résolution PostgREST.
-- ============================================================================

drop function if exists public.create_organization(text);

create or replace function public.create_organization(
  p_name text,
  p_role text default 'owner'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_role text := lower(btrim(coalesce(p_role, 'owner')));
  v_slug text;
  v_org public.organizations;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if v_name = '' then
    raise exception 'ORG_NAME_REQUIRED';
  end if;

  if v_role not in ('owner', 'admin', 'member') then
    raise exception 'ORG_ROLE_INVALID';
  end if;

  v_slug := public.slugify(v_name);
  if exists (select 1 from public.organizations o where o.slug = v_slug) then
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into public.organizations (name, slug)
  values (v_name, v_slug)
  returning * into v_org;

  insert into public.organization_members (org_id, user_id, role)
  values (v_org.id, v_user, v_role);

  return jsonb_build_object(
    'id', v_org.id,
    'name', v_org.name,
    'slug', v_org.slug,
    'plan', v_org.plan,
    'role', v_role,
    'createdAt', v_org.created_at
  );
end;
$$;

revoke all on function public.create_organization(text, text) from public;
grant execute on function public.create_organization(text, text) to authenticated;
