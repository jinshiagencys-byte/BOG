/**
 * Envoi de l'email d'invitation à une organisation.
 *
 * Appelée par le navigateur avec le JWT de l'utilisateur après
 * `invite_organization_member`. La fonction :
 *   1. vérifie que l'appelant est owner/admin de l'organisation ;
 *   2. vérifie qu'une invitation en attente existe pour cet email ;
 *   3. envoie l'email via Supabase Auth :
 *        - « invite » pour une adresse sans compte ;
 *        - « magic link » pour un compte existant.
 *
 * L'adhésion n'est jamais créée ici : elle le sera par
 * `accept_my_invitations()` quand la personne sera authentifiée dans l'app.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fail, json, preflight } from '../_shared/http.ts';
import { serviceClient } from '../_shared/supabase.ts';

const LOCAL_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]);

function allowedOrigins(): string[] {
  return (Deno.env.get('APP_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

/** Évite qu'un lien d'invitation renvoie les jetons vers un domaine inconnu. */
function resolveRedirect(value: unknown, origin: string | null): string {
  const fallback = (Deno.env.get('APP_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
  const extra = allowedOrigins();
  const candidates = [
    typeof value === 'string' ? value : null,
    origin ? `${origin}/auth/callback` : null,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (LOCAL_ORIGINS.has(url.origin) || extra.includes(url.origin)) {
        return `${url.origin}/auth/callback`;
      }
    } catch {
      /* candidat invalide : on essaie le suivant */
    }
  }

  return `${fallback}/auth/callback`;
}

function emailErrorCode(message: string): string {
  if (/rate limit|too many|email rate|over email/i.test(message)) {
    return 'EMAIL_RATE_LIMITED';
  }
  return 'INVITE_EMAIL_FAILED';
}

function alreadyRegistered(message: string): boolean {
  return /already|registered|exists|duplicate/i.test(message);
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return fail('AUTH_REQUIRED', 401);

  let body: { orgId?: string; email?: string; redirectTo?: string };
  try {
    body = await req.json();
  } catch {
    return fail('INVALID_JSON', 400);
  }

  const orgId = String(body.orgId ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!orgId || !email) return fail('INVITE_FIELDS_REQUIRED', 400);

  const service = serviceClient();
  const { data: userData, error: userError } = await service.auth.getUser(token);
  if (userError || !userData.user) return fail('AUTH_INVALID', 401);

  // L'appelant doit être owner/admin de l'organisation.
  const { data: membership, error: membershipError } = await service
    .from('organization_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userData.user.id)
    .maybeSingle();

  if (membershipError) return fail('ORG_QUERY_FAILED', 500, membershipError.message);
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return fail('ORG_FORBIDDEN', 403);
  }

  // Une invitation en attente doit exister avant tout envoi.
  const { data: invitation, error: invitationError } = await service
    .from('organization_invitations')
    .select('id, email, role, status')
    .eq('org_id', orgId)
    .eq('email', email)
    .eq('status', 'pending')
    .maybeSingle();

  if (invitationError) return fail('INVITE_QUERY_FAILED', 500, invitationError.message);
  if (!invitation) return fail('INVITE_NOT_FOUND', 404);

  const { data: org, error: orgError } = await service
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle();

  if (orgError) return fail('ORG_QUERY_FAILED', 500, orgError.message);

  const redirectTo = resolveRedirect(body.redirectTo, req.headers.get('origin'));
  const metadata = {
    org_id: orgId,
    org_name: org?.name ?? '',
    invitation: true,
  };

  // 1) Adresse inconnue : l'email « invite » de Supabase crée le compte.
  const { error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: metadata,
  });

  if (!inviteError) {
    return json({
      sent: true,
      channel: 'invite',
      email,
      orgId,
    });
  }

  // 2) Compte déjà existant : on envoie un magic link avec les métadonnées
  //    de l'invitation. `shouldCreateUser: false` évite toute création.
  if (alreadyRegistered(inviteError.message ?? '')) {
    const anon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { error: otpError } = await anon.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo,
        data: metadata,
      },
    });

    if (!otpError) {
      return json({
        sent: true,
        channel: 'magiclink',
        email,
        orgId,
      });
    }

    return json({
      sent: false,
      channel: null,
      email,
      orgId,
      error: emailErrorCode(otpError.message ?? ''),
      detail: otpError.message ?? null,
    });
  }

  return json({
    sent: false,
    channel: null,
    email,
    orgId,
    error: emailErrorCode(inviteError.message ?? ''),
    detail: inviteError.message ?? null,
  });
});
