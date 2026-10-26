-- ============================================================================
-- V2 — 08 — Invitations de membres depuis l'onboarding
--
-- L'écran « Invitez votre équipe » permet au créateur (owner/admin) d'ajouter
-- des membres par email avec un rôle. Deux cas :
--   • le compte existe déjà → l'adhésion est créée immédiatement ;
--   • le compte n'existe pas → une invitation « pending » est enregistrée.
--
-- Les invitations en attente sont acceptées automatiquement à la prochaine
-- connexion de la personne avec la même adresse email. Aucun email n'est envoyé
-- par cette migration : le transport d'email pourra être branché plus tard.
-- ============================================================================

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint organization_invitations_email_lower check (email = lower(email)),
  constraint organization_invitations_org_email_key unique (org_id, email)
);

create index if not exists organization_invitations_email_idx
  on public.organization_invitations (lower(email));

-- Accès uniquement via les fonctions SECURITY DEFINER ci-dessous.
alter table public.organization_invitations enable row level security;
revoke all on public.organization_invitations from public;
revoke all on public.organization_invitations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Liste des membres actifs + invitations en attente
-- ---------------------------------------------------------------------------

create or replace function public.list_organization_team(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_rows jsonb;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if not public.is_org_member(p_org_id) then
    raise exception 'ORG_FORBIDDEN';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'email', t.email,
        'fullName', t.full_name,
        'role', t.role,
        'status', t.status,
        'createdAt', t.created_at,
        'userId', t.user_id
      )
      order by t.sort_order, t.email
    ),
    '[]'::jsonb
  )
  into v_rows
  from (
    select
      coalesce(u.email, '') as email,
      coalesce(u.raw_user_meta_data->>'full_name', '') as full_name,
      m.role,
      'active'::text as status,
      m.created_at,
      m.user_id,
      0 as sort_order
    from public.organization_members m
    join auth.users u on u.id = m.user_id
    where m.org_id = p_org_id
      and u.email is not null

    union all

    select
      i.email,
      ''::text as full_name,
      i.role,
      'invited'::text as status,
      i.created_at,
      null::uuid as user_id,
      1 as sort_order
    from public.organization_invitations i
    where i.org_id = p_org_id
      and i.status = 'pending'
  ) t;

  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ajout / invitation d'un membre
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

    insert into public.organization_members (org_id, user_id, role)
    values (p_org_id, v_target, v_role);

    return jsonb_build_object(
      'status', 'added',
      'email', v_email,
      'role', v_role,
      'userId', v_target
    );
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
    'invitationId', v_invitation.id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Acceptation automatique à la connexion
-- ---------------------------------------------------------------------------

create or replace function public.accept_my_invitations()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_invitation record;
  v_count integer := 0;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_user;

  if v_email is null then
    return jsonb_build_object('accepted', 0);
  end if;

  for v_invitation in
    select *
    from public.organization_invitations
    where lower(email) = v_email
      and status = 'pending'
    for update
  loop
    insert into public.organization_members (org_id, user_id, role)
    values (v_invitation.org_id, v_user, v_invitation.role)
    on conflict (org_id, user_id) do nothing;

    update public.organization_invitations
    set status = 'accepted',
        accepted_at = now()
    where id = v_invitation.id;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('accepted', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------

revoke all on function public.list_organization_team(uuid) from public;
revoke all on function public.invite_organization_member(uuid, text, text) from public;
revoke all on function public.accept_my_invitations() from public;

grant execute on function public.list_organization_team(uuid) to authenticated;
grant execute on function public.invite_organization_member(uuid, text, text) to authenticated;
grant execute on function public.accept_my_invitations() to authenticated;
