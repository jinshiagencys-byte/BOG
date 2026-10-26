-- ============================================================================
-- V2 — 09 — Rôle du créateur sur la page « Invitez votre équipe »
--
-- Le rôle n'est plus demandé à la création de l'organisation : il est choisi
-- sur l'écran d'invitation. On mémorise donc le créateur de l'organisation
-- (`created_by`) pour l'autoriser à modifier son propre rôle.
--
-- Les invitations changent aussi de nature : une adresse est TOUJOURS une
-- invitation en attente, même si un compte existe déjà. L'adhésion n'est créée
-- qu'au moment où la personne s'authentifie dans l'app, via
-- `accept_my_invitations()`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Créateur de l'organisation
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists organizations_created_by_idx
  on public.organizations (created_by);

-- Rétro-remplissage : pour les organisations existantes, le créateur est le
-- premier membre (ordre de création de l'adhésion).
update public.organizations o
set created_by = first_member.user_id
from (
  select distinct on (m.org_id) m.org_id, m.user_id
  from public.organization_members m
  order by m.org_id, m.created_at asc
) as first_member
where o.created_by is null
  and first_member.org_id = o.id;

-- ---------------------------------------------------------------------------
-- Création d'organisation : enregistre le créateur
-- ---------------------------------------------------------------------------

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

  insert into public.organizations (name, slug, created_by)
  values (v_name, v_slug, v_user)
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

-- ---------------------------------------------------------------------------
-- Le créateur choisit son propre rôle depuis l'écran d'invitation
-- ---------------------------------------------------------------------------

create or replace function public.set_my_organization_role(
  p_org_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_role text := lower(btrim(coalesce(p_role, '')));
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if v_role not in ('owner', 'admin', 'member') then
    raise exception 'ORG_ROLE_INVALID';
  end if;

  if not exists (
    select 1
    from public.organizations o
    where o.id = p_org_id
      and o.created_by = v_user
  ) then
    raise exception 'ORG_FORBIDDEN';
  end if;

  update public.organization_members m
  set role = v_role
  where m.org_id = p_org_id
    and m.user_id = v_user;

  if not found then
    raise exception 'ORG_FORBIDDEN';
  end if;

  return jsonb_build_object('role', v_role);
end;
$$;

revoke all on function public.set_my_organization_role(uuid, text) from public;
grant execute on function public.set_my_organization_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Invitation : ne crée plus l'adhésion immédiatement
-- ---------------------------------------------------------------------------

create or replace function public.invite_organization_member(
  p_org_id uuid,
  p_email text,
  p_role text default 'member'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := lower(btrim(coalesce(p_role, 'member')));
  v_target uuid;
  v_invitation public.organization_invitations;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if not public.has_org_role(p_org_id, array['owner', 'admin']) then
    raise exception 'ORG_FORBIDDEN';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVITE_EMAIL_INVALID';
  end if;

  if v_role not in ('admin', 'member') then
    raise exception 'ORG_ROLE_INVALID';
  end if;

  select u.id into v_target
  from auth.users u
  where lower(u.email) = v_email
  limit 1;

  if v_target is not null then
    if v_target = v_user then
      raise exception 'INVITE_SELF';
    end if;

    if exists (
      select 1
      from public.organization_members m
      where m.org_id = p_org_id
        and m.user_id = v_target
    ) then
      return jsonb_build_object(
        'status', 'already_member',
        'email', v_email,
        'role', v_role
      );
    end if;
  end if;

  insert into public.organization_invitations (org_id, email, role, invited_by)
  values (p_org_id, v_email, v_role, v_user)
  on conflict (org_id, email) do update
    set role = excluded.role,
        invited_by = excluded.invited_by,
        status = 'pending',
        created_at = now(),
        accepted_at = null
  returning * into v_invitation;

  return jsonb_build_object(
    'status', 'invited',
    'email', v_email,
    'role', v_role,
    'invitationId', v_invitation.id,
    'hasAccount', v_target is not null
  );
end;
$$;

revoke all on function public.invite_organization_member(uuid, text, text) from public;
grant execute on function public.invite_organization_member(uuid, text, text) to authenticated;
