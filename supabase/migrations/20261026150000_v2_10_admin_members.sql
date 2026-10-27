-- ============================================================================
-- V2 — 10 — Administration des membres (page « Utilisateurs et rôles »)
--
-- La page /users permet de changer le rôle d'un membre, de le retirer et de
-- révoquer une invitation en attente. Ces opérations passent par des fonctions
-- SECURITY DEFINER pour appliquer une hiérarchie explicite :
--
--   • owner  : gère tout le monde, sauf retirer le dernier propriétaire ;
--   • admin  : gère les membres, peut promouvoir un membre en admin, mais ne
--              peut ni modifier un admin existant, ni toucher à un owner ;
--   • member : aucun droit de gestion.
--
-- Personne ne peut changer son propre rôle par ces fonctions : le créateur
-- garde `set_my_organization_role` pour le choix fait pendant l'onboarding.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Changer le rôle d'un membre
-- ---------------------------------------------------------------------------

create or replace function public.update_organization_member_role(
  p_org_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_current_role text;
  v_next_role text := lower(btrim(coalesce(p_role, '')));
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if v_next_role not in ('owner', 'admin', 'member') then
    raise exception 'ORG_ROLE_INVALID';
  end if;

  -- Le rôle du créateur se change depuis l'onboarding, pas depuis la table.
  if p_user_id = v_actor then
    raise exception 'MEMBER_SELF';
  end if;

  select m.role into v_actor_role
  from public.organization_members m
  where m.org_id = p_org_id
    and m.user_id = v_actor;

  -- `role` est NULL quand l'appelant n'est pas membre : le test explicite
  -- évite que `NULL not in (...)` laisse passer l'appel.
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception 'ORG_FORBIDDEN' using errcode = '42501';
  end if;

  select m.role into v_current_role
  from public.organization_members m
  where m.org_id = p_org_id
    and m.user_id = p_user_id;

  if v_current_role is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  if v_actor_role = 'admin' then
    if v_current_role <> 'member' then
      raise exception 'ORG_FORBIDDEN' using errcode = '42501';
    end if;
    if v_next_role = 'owner' then
      raise exception 'ORG_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  -- Un propriétaire ne peut être rétrogradé que s'il en reste un autre.
  if v_current_role = 'owner' and v_next_role <> 'owner' then
    if not exists (
      select 1
      from public.organization_members m
      where m.org_id = p_org_id
        and m.role = 'owner'
        and m.user_id <> p_user_id
    ) then
      raise exception 'MEMBER_LAST_OWNER';
    end if;
  end if;

  update public.organization_members
  set role = v_next_role
  where org_id = p_org_id
    and user_id = p_user_id;

  return jsonb_build_object('userId', p_user_id, 'role', v_next_role);
end;
$$;

-- ---------------------------------------------------------------------------
-- Retirer un membre
-- ---------------------------------------------------------------------------

create or replace function public.remove_organization_member(
  p_org_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_current_role text;
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  -- Quitter une organisation est un flux distinct, non exposé ici.
  if p_user_id = v_actor then
    raise exception 'MEMBER_SELF';
  end if;

  select m.role into v_actor_role
  from public.organization_members m
  where m.org_id = p_org_id
    and m.user_id = v_actor;

  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
    raise exception 'ORG_FORBIDDEN' using errcode = '42501';
  end if;

  select m.role into v_current_role
  from public.organization_members m
  where m.org_id = p_org_id
    and m.user_id = p_user_id;

  if v_current_role is null then
    raise exception 'MEMBER_NOT_FOUND';
  end if;

  -- Un admin ne peut retirer que des membres.
  if v_actor_role = 'admin' and v_current_role <> 'member' then
    raise exception 'ORG_FORBIDDEN' using errcode = '42501';
  end if;

  if v_current_role = 'owner' then
    if not exists (
      select 1
      from public.organization_members m
      where m.org_id = p_org_id
        and m.role = 'owner'
        and m.user_id <> p_user_id
    ) then
      raise exception 'MEMBER_LAST_OWNER';
    end if;
  end if;

  delete from public.organization_members
  where org_id = p_org_id
    and user_id = p_user_id;

  return jsonb_build_object('userId', p_user_id, 'removed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Révoquer une invitation en attente
-- ---------------------------------------------------------------------------

create or replace function public.revoke_organization_invitation(
  p_org_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_actor is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if not public.has_org_role(p_org_id, array['owner', 'admin']) then
    raise exception 'ORG_FORBIDDEN' using errcode = '42501';
  end if;

  if v_email = '' then
    raise exception 'INVITE_EMAIL_INVALID';
  end if;

  update public.organization_invitations
  set status = 'revoked',
      accepted_at = null
  where org_id = p_org_id
    and email = v_email
    and status = 'pending';

  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  return jsonb_build_object('email', v_email, 'status', 'revoked');
end;
$$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------

revoke all on function public.update_organization_member_role(uuid, uuid, text) from public;
revoke all on function public.remove_organization_member(uuid, uuid) from public;
revoke all on function public.revoke_organization_invitation(uuid, text) from public;

grant execute on function public.update_organization_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_organization_member(uuid, uuid) to authenticated;
grant execute on function public.revoke_organization_invitation(uuid, text) to authenticated;
