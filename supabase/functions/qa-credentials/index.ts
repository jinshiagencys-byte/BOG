import { fail, json, preflight } from '../_shared/http.ts';
import { serviceClient, sha256Hex } from '../_shared/supabase.ts';

/**
 * Fournit à un workflow QA déjà autorisé la clé OpenRouter nécessaire à
 * IronBee. La clé n'est jamais renvoyée au navigateur : seuls le workflow
 * GitHub (via x-run-token) et l'Edge Function la voient.
 *
 * Le jeton de run est court, lié à un run précis et révocable. La fonction
 * vérifie le hash, l'expiration et l'identifiant du run avant de répondre.
 */
Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return fail('METHOD_NOT_ALLOWED', 405);
  }

  const token = (req.headers.get('x-run-token') ?? '').trim();
  if (!token) return fail('RUN_TOKEN_REQUIRED', 401);

  const url = new URL(req.url);
  const requestedRunId = (url.searchParams.get('run_id') ?? '').trim();

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
  if (requestedRunId && requestedRunId !== tokenRow.run_id) {
    return fail('RUN_TOKEN_INVALID', 401);
  }

  const apiKey = (Deno.env.get('OPENROUTER_API_KEY') ?? '').trim();
  if (!apiKey) return fail('OPENROUTER_NOT_CONFIGURED', 503);

  return json({
    run_id: tokenRow.run_id,
    expires_at: tokenRow.expires_at,
    openrouter_api_key: apiKey,
    typesafe_url: 'https://openrouter.ai/api/v1/systemone',
    typesafe_model: 'jev-latest',
  });
});
