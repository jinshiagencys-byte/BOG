import { fail, json, preflight } from '../_shared/http.ts';
import { serviceClient, sha256Hex } from '../_shared/supabase.ts';

type StepStatus = 'passed' | 'failed' | 'blocked' | 'skipped';
type CaseStatus = StepStatus;

type RawStep = {
  n?: number | string | null;
  code?: string | null;
  action?: string | null;
  expected?: string | null;
  precondition?: string | null;
  actual?: string | null;
  status?: string | null;
  evidence?: Record<string, unknown> | null;
};

type RawCase = {
  id?: string | null;
  code?: string | null;
  title?: string | null;
  category?: string | null;
  suite?: string | null;
  description?: string | null;
  discovered?: boolean | null;
  severity?: string | null;
  status?: string | null;
  note?: string | null;
  duration_ms?: number | string | null;
  failure_message?: string | null;
  stack_trace?: string | null;
  retry_count?: number | string | null;
  started_at?: string | null;
  finished_at?: string | null;
  artifacts?: unknown;
  steps?: RawStep[] | null;
};

const STEP_STATUSES = new Set<StepStatus>([
  'passed',
  'failed',
  'blocked',
  'skipped',
]);

const SUITE_BY_CATEGORY: Record<string, string> = {
  functional: 'Fonctionnel',
  security: 'Sécurité',
  accessibility: 'Accessibilité',
  seo: 'Référencement',
};

function stepStatus(value: unknown): StepStatus {
  return STEP_STATUSES.has(value as StepStatus)
    ? value as StepStatus
    : 'failed';
}

/**
 * Même règle que la normalisation du workflow : le statut du cas est dérivé
 * des étapes, jamais de la déclaration du modèle.
 */
function caseStatus(steps: RawStep[]): CaseStatus {
  if (steps.length === 0) return 'blocked';
  if (steps.some((step) => stepStatus(step.status) === 'failed')) return 'failed';
  if (steps.some((step) => stepStatus(step.status) === 'blocked')) return 'blocked';
  if (steps.every((step) => stepStatus(step.status) === 'skipped')) return 'skipped';
  return 'passed';
}

function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeCase(raw: RawCase) {
  const code = (asText(raw.code) ?? asText(raw.id) ?? '').trim();
  if (!code) return null;

  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const steps = rawSteps.map((step) => ({
    n: asInteger(step.n),
    code: asText(step.code),
    action: asText(step.action) ?? '',
    expected: asText(step.expected) ?? '',
    precondition: asText(step.precondition) ?? '',
    actual: asText(step.actual) ?? 'non renseigné',
    status: stepStatus(step.status),
    evidence:
      step.evidence && typeof step.evidence === 'object' && !Array.isArray(step.evidence)
        ? step.evidence
        : {},
  }));

  const category = asText(raw.category);
  const suite = asText(raw.suite) ??
    (category ? SUITE_BY_CATEGORY[category] : null) ??
    'Découvertes';
  const severity = raw.severity === 'P0' || raw.severity === 'P1' || raw.severity === 'P2'
    ? raw.severity
    : null;

  return {
    code,
    status: caseStatus(steps),
    severity,
    discovered: raw.discovered === true,
    title: asText(raw.title) ?? code,
    category,
    suite,
    description: asText(raw.description) ?? '',
    note: asText(raw.note),
    duration_ms: asInteger(raw.duration_ms),
    failure_message: asText(raw.failure_message),
    stack_trace: asText(raw.stack_trace),
    retry_count: asInteger(raw.retry_count),
    started_at: asText(raw.started_at),
    finished_at: asText(raw.finished_at),
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
    steps,
  };
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);

  const token = (req.headers.get('x-run-token') ?? '').trim();
  if (!token) return fail('RUN_TOKEN_REQUIRED', 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return fail('INVALID_JSON', 400);
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

  const requestedRunId = (asText(body.run_id) ?? asText(body.runId) ?? '').trim();
  if (requestedRunId && requestedRunId !== tokenRow.run_id) {
    return fail('RUN_TOKEN_INVALID', 401);
  }
  const runId = requestedRunId || tokenRow.run_id;

  const rawCases = Array.isArray(body.cases)
    ? body.cases as RawCase[]
    : Array.isArray(body.test_cases)
    ? body.test_cases as RawCase[]
    : [];

  const cases = rawCases
    .map((raw) => normalizeCase(raw))
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const passed = cases.filter((value) => value.status === 'passed').length;
  const failed = cases.filter((value) => value.status === 'failed').length;
  const blocked = cases.filter((value) => value.status === 'blocked').length;

  // Le workflow déclare son exécuteur ; on ne l'écrase plus avec une valeur
  // par défaut historique. La liste reste fermée pour éviter qu'une valeur
  // arbitraire entre en base.
  const allowedExecutors = new Set(['fastbrowse', 'antigravity', 'ironbee', 'jev-ra', 'webmcp', 'manual']);
  const requestedExecutor = (asText(body.executor) ?? '').trim().toLowerCase();
  const executor = allowedExecutors.has(requestedExecutor)
    ? requestedExecutor
    : 'fastbrowse';

  const payload = {
    status: body.status === 'error'
      ? 'error'
      : (failed > 0 || blocked > 0 ? 'failed' : 'passed'),
    model: asText(body.model),
    executor,
    github_run_id: body.github_run_id ?? body.githubRunId ?? null,
    github_run_attempt: body.github_run_attempt ?? body.githubRunAttempt ?? null,
    github_run_url: asText(body.github_run_url) ?? asText(body.githubRunUrl),
    duration_ms: asInteger(body.duration_ms),
    error_message: asText(body.error_message),
    side_effects: Array.isArray(body.side_effects) ? body.side_effects : [],
    cases,
  };

  const { data, error } = await service.rpc('report_run', {
    p_run_id: runId,
    p_token: token,
    p_payload: payload,
  });

  if (error) {
    const message = error.message ?? '';
    if (message.includes('RUN_TOKEN_INVALID')) return fail('RUN_TOKEN_INVALID', 401);
    if (message.includes('RUN_NOT_FOUND')) return fail('RUN_NOT_FOUND', 404);
    if (message.includes('RUN_PAYLOAD_INVALID')) {
      return fail('RUN_PAYLOAD_INVALID', 400);
    }
    return fail('REPORT_FAILED', 500, message);
  }

  return json(data);
});
