/**
 * save-site-profile — enregistre le profil d'exploration d'un site.
 *
 * Appelée par le runner Playwright avec le jeton éphémère du run. Le profil
 * (faits observés) et les cas enrichis sont stockés ensemble ; l'application
 * les lit ensuite via la RLS (membre de l'organisation).
 *
 * Une nouvelle exploration remplace la précédente et repousse l'échéance de
 * sept jours. Un échec d'enregistrement ne change jamais le verdict du run.
 */
import { fail, json, preflight } from '../_shared/http.ts';
import { serviceClient, sha256Hex } from '../_shared/supabase.ts';

const MAX_BYTES = 400 * 1024;
const RETENTION_DAYS = 7;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);

  const token = (req.headers.get('x-run-token') ?? '').trim();
  if (!token) return fail('RUN_TOKEN_REQUIRED', 401);

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return fail('PROFILE_TOO_LARGE', 413);

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    const object = asObject(parsed);
    if (!object) return fail('BODY_INVALID', 400, 'objet JSON attendu');
    body = object;
  } catch {
    return fail('BODY_INVALID', 400, 'JSON invalide');
  }

  const profile = asObject(body.profile);
  if (!profile) return fail('PROFILE_REQUIRED', 400);

  const enrichments = asObject(body.enrichments) ?? {};
  const status = body.status === 'partial' || body.status === 'failed' ? body.status : 'ready';
  const source = body.source === 'llm' || body.source === 'hybrid' ? body.source : 'crawler';
  const issues = Array.isArray(body.issues) ? body.issues.slice(0, 50) : [];

  const service = serviceClient();
  const tokenHash = await sha256Hex(token);

  const { data: tokenRow, error: tokenError } = await service
    .from('ci_run_tokens')
    .select('run_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (tokenError) return fail('RUN_TOKEN_QUERY_FAILED', 500, tokenError.message);
  if (!tokenRow) return fail('RUN_TOKEN_INVALID', 401);
  if (tokenRow.revoked_at) return fail('RUN_TOKEN_REVOKED', 401);
  if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    return fail('RUN_TOKEN_EXPIRED', 401);
  }

  const { data: run, error: runError } = await service
    .from('test_runs')
    .select('id, site_id')
    .eq('id', tokenRow.run_id)
    .maybeSingle();

  if (runError) return fail('RUN_QUERY_FAILED', 500, runError.message);
  if (!run?.site_id) return fail('RUN_NOT_FOUND', 404);

  const { data: existing } = await service
    .from('site_profiles')
    .select('id, version')
    .eq('site_id', run.site_id)
    .maybeSingle();

  const capturedAt = profile.captured_at ?? new Date().toISOString();
  const expiresAt = new Date(Date.now() + RETENTION_DAYS * 86400000).toISOString();

  const row = {
    site_id: run.site_id,
    version: existing ? Number(existing.version) + 1 : 1,
    captured_at: capturedAt,
    expires_at: expiresAt,
    source,
    status,
    profile,
    enrichments,
    issues,
    error: typeof body.error === 'string' ? body.error.slice(0, 500) : null,
  };

  const { data: saved, error: saveError } = existing
    ? await service
        .from('site_profiles')
        .update(row)
        .eq('id', existing.id)
        .select('id, site_id, version, captured_at, expires_at, status')
        .single()
    : await service
        .from('site_profiles')
        .insert(row)
        .select('id, site_id, version, captured_at, expires_at, status')
        .single();

  if (saveError) return fail('PROFILE_SAVE_FAILED', 500, saveError.message);

  return json({
    id: saved.id,
    site_id: saved.site_id,
    version: saved.version,
    captured_at: saved.captured_at,
    expires_at: saved.expires_at,
    status: saved.status,
    enrichments: Object.keys(enrichments).length,
  });
});
