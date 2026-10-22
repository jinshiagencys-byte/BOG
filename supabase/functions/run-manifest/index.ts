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
    .select('id, status, manifest')
    .eq('id', runId)
    .maybeSingle();

  if (runError) return fail('RUN_QUERY_FAILED', 500, runError.message);
  if (!run?.manifest) return fail('RUN_NOT_FOUND', 404);

  return json(run.manifest);
});
