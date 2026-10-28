import { fail, json, preflight } from '../_shared/http.ts';
import { serviceClient, sha256Hex } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return fail('METHOD_NOT_ALLOWED', 405);
  }

  const token = (req.headers.get('x-run-token') ?? '').trim();
  if (!token) return fail('RUN_TOKEN_REQUIRED', 401);

  const url = new URL(req.url);
  const runId = (url.searchParams.get('run_id') ?? '').trim();
  if (!runId) return fail('RUN_ID_REQUIRED', 400);

  const service = serviceClient();
  const tokenHash = await sha256Hex(token);

  const { data: tokenRow, error: tokenError } = await service
    .from('ci_run_tokens')
    .select('run_id, expires_at, revoked_at')
    .eq('run_id', runId)
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
    .select('id, site_id, status, manifest')
    .eq('id', runId)
    .maybeSingle();

  if (runError) return fail('RUN_QUERY_FAILED', 500, runError.message);
  if (!run?.manifest) return fail('RUN_NOT_FOUND', 404);

  // Le profil d'exploration accompagne le manifeste quand il est encore frais
  // (moins de sept jours). Sinon le runner explore lui-même avant d'exécuter.
  const { data: profileRow } = await service
    .from('site_profiles')
    .select('version, profile, enrichments, captured_at, expires_at, status, source')
    .eq('site_id', run.site_id)
    .maybeSingle();

  const fresh =
    profileRow != null && new Date(profileRow.expires_at).getTime() > Date.now();

  return json({
    ...run.manifest,
    profile: fresh ? profileRow.profile : null,
    enrichments: fresh ? profileRow.enrichments : {},
    profile_meta: profileRow
      ? {
          version: profileRow.version,
          captured_at: profileRow.captured_at,
          expires_at: profileRow.expires_at,
          status: profileRow.status,
          source: profileRow.source,
          fresh,
        }
      : null,
  });
});
