-- ============================================================================
-- V2 — 10b — Garde NULL sur les fonctions d'administration des membres
--
-- `20261026150000_v2_10_admin_members.sql` a été appliquée avant l'ajout de ce
-- garde. Quand l'appelant n'est pas membre, `v_actor_role` vaut NULL et
-- `NULL not in ('owner', 'admin')` vaut NULL : le test ne déclenchait pas
-- l'exception. On réécrit les deux fonctions avec un test explicite.
-- ============================================================================

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

  if v_actor_role = 'admin' then
    if v_current_role <> 'member' then
      raise exception 'ORG_FORBIDDEN' using errcode = '42501';
    end if;
    if v_next_role = 'owner' then
      raise exception 'ORG_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

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

revoke all on function public.update_organization_member_role(uuid, uuid, text) from public;
revoke all on function public.remove_organization_member(uuid, uuid) from public;

grant execute on function public.update_organization_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_organization_member(uuid, uuid) to authenticated;
