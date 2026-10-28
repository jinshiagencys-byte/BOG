/**
 * purge-evidence — applique la rétention des vidéos du bucket qa-evidence.
 *
 * Appelée par `pg_cron` (fonction `qa_run_evidence_purge`) avec le secret
 * `PURGE_SECRET`, ou à la main pour un contrôle. Elle ne décide de rien :
 * `qa_evidence_expired` liste les chemins arrivés à échéance (30 jours, 90 pour
 * les cas échoués), et cette fonction les supprime via l'API Storage.
 *
 * `dry_run` permet de voir ce qui partirait sans rien supprimer.
 */
import { fail, json, preflight } from '../_shared/http.ts';
import { serviceClient } from '../_shared/supabase.ts';

const BUCKET = 'qa-evidence';
const MAX_BATCHES = 3;
const MAX_BATCH_SIZE = 500;
const MAX_RETENTION_DAYS = 3650;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Comparaison à temps constant : le secret ne doit pas fuir par la durée. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

type Candidate = {
  path: string;
  run_id: string | null;
  run_status: string | null;
  run_started_at: string | null;
  age_days: number | null;
};

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);

  const expected = (Deno.env.get('PURGE_SECRET') ?? '').trim();
  if (!expected) return fail('PURGE_NOT_CONFIGURED', 503);

  const provided = (req.headers.get('x-purge-secret') ?? '').trim();
  if (!provided || !safeEqual(provided, expected)) {
    return fail('PURGE_FORBIDDEN', 401);
  }

  let body: Record<string, unknown> = {};
  const raw = await req.text();
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fail('BODY_INVALID', 400, 'objet JSON attendu');
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return fail('BODY_INVALID', 400, 'JSON invalide');
    }
  }

  const dryRun = body.dry_run === true;
  const retentionDays = clamp(
    asInt(body.retention_days, 30),
    0,
    MAX_RETENTION_DAYS,
  );
  const failedRetentionDays = clamp(
    asInt(body.failed_retention_days, 90),
    retentionDays,
    MAX_RETENTION_DAYS,
  );
  const limit = clamp(asInt(body.limit, MAX_BATCH_SIZE), 1, 1000);

  const rawRunId = typeof body.run_id === 'string' ? body.run_id.trim() : '';
  if (rawRunId && !UUID_RE.test(rawRunId)) {
    return fail('RUN_ID_INVALID', 400);
  }
  const runId = rawRunId || null;

  const service = serviceClient();
  const batches = dryRun ? 1 : MAX_BATCHES;
  const samples: Array<Record<string, unknown>> = [];
  let deleted = 0;
  let scanned = 0;
  let round = 0;
  let batchesRun = 0;

  for (; round < batches; round += 1) {
    batchesRun += 1;
    const { data, error } = await service.rpc('qa_evidence_expired', {
      p_retention_days: retentionDays,
      p_failed_retention_days: failedRetentionDays,
      p_run_id: runId,
      p_limit: limit,
    });

    if (error) return fail('PURGE_QUERY_FAILED', 500, error.message);

    const candidates = (data ?? []) as Candidate[];
    if (!candidates.length) break;

    scanned += candidates.length;
    for (const candidate of candidates) {
      if (samples.length < 50) {
        samples.push({
          path: candidate.path,
          run_id: candidate.run_id,
          run_status: candidate.run_status,
          age_days: candidate.age_days,
        });
      }
    }

    if (dryRun) break;

    const paths = candidates.map((candidate) => candidate.path);
    const { error: removeError } = await service.storage
      .from(BUCKET)
      .remove(paths);

    if (removeError) {
      return json(
        {
          error: 'PURGE_DELETE_FAILED',
          detail: removeError.message,
          deleted,
          scanned,
          samples,
        },
        500,
      );
    }

    deleted += paths.length;
    if (candidates.length < limit) break;
  }

  return json({
    dry_run: dryRun,
    retention_days: retentionDays,
    failed_retention_days: failedRetentionDays,
    run_id: runId,
    batches: batchesRun,
    scanned,
    deleted,
    remaining: scanned - deleted,
    samples,
  });
});
