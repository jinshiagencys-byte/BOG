/**
 * upload-evidence — dépose la vidéo d'un cas QA dans le bucket privé.
 *
 * Appelée par le runner Playwright/WebMCP avec le jeton éphémère du run
 * (`x-run-token`), jamais depuis le navigateur. Le fichier est stocké sous
 * `<org_id>/<run_id>/<CODE>.webm` ; l'application le lit ensuite via une URL
 * signée, contrôlée par la policy `qa_evidence_member_read`.
 *
 * Le corps est binaire (video/webm). Aucun LLM, aucune clé côté CI.
 */
import { fail, json, preflight } from '../_shared/http.ts';
import { serviceClient, sha256Hex } from '../_shared/supabase.ts';

const MAX_BYTES = 25 * 1024 * 1024;
const CODE_RE = /^[A-Za-z0-9._-]{1,80}$/;

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);

  const token = (req.headers.get('x-run-token') ?? '').trim();
  if (!token) return fail('RUN_TOKEN_REQUIRED', 401);

  const code = asText(req.headers.get('x-case-code'));
  if (!CODE_RE.test(code)) return fail('CASE_CODE_INVALID', 400);

  const contentType = (req.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith('video/')) {
    return fail('CONTENT_TYPE_INVALID', 415, 'content-type video/* attendu');
  }

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) {
    return fail('EVIDENCE_TOO_LARGE', 413, `${declared} octets`);
  }

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

  const runId = tokenRow.run_id as string;

  const { data: run, error: runError } = await service
    .from('test_runs')
    .select('id, site_id')
    .eq('id', runId)
    .maybeSingle();

  if (runError) return fail('RUN_QUERY_FAILED', 500, runError.message);
  if (!run) return fail('RUN_NOT_FOUND', 404);

  const { data: site, error: siteError } = await service
    .from('sites')
    .select('org_id')
    .eq('id', run.site_id)
    .maybeSingle();

  if (siteError) return fail('SITE_QUERY_FAILED', 500, siteError.message);
  if (!site?.org_id) return fail('ORG_NOT_FOUND', 409);

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.byteLength) return fail('EVIDENCE_EMPTY', 400);
  if (bytes.byteLength > MAX_BYTES) {
    return fail('EVIDENCE_TOO_LARGE', 413, `${bytes.byteLength} octets`);
  }

  const extension = contentType.includes('mp4') ? 'mp4' : 'webm';
  const path = `${site.org_id}/${runId}/${code}.${extension}`;

  const { error: uploadError } = await service.storage
    .from('qa-evidence')
    .upload(path, bytes, {
      contentType: contentType.split(';')[0],
      upsert: true,
      cacheControl: '3600',
    });

  if (uploadError) {
    return fail('UPLOAD_FAILED', 500, uploadError.message);
  }

  return json({ path, size: bytes.byteLength });
});
