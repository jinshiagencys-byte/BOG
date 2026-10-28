import { fail, json, preflight } from '../_shared/http.ts';
import { serviceClient, userClient } from '../_shared/supabase.ts';
import { dispatchWorkflow, installationToken } from '../_shared/github.ts';

type StartRunBody = {
  siteId?: string;
  caseIds?: string[];
  trigger?: string;
  branch?: string | null;
  environment?: string | null;
  commitSha?: string | null;
  commitMessage?: string | null;
  prNumber?: number | null;
  tags?: string[];
  model?: string;
  executor?: string;
};

const VALID_TRIGGERS = new Set(['manual', 'schedule', 'new_site', 'ci']);

// Modèles OpenCode Zen utilisables par Antigravity via le proxy Gemini local.
const OPENCODE_MODELS = new Set([
  'deepseek-v4.1-flash-free',
  'big-pickle',
  'beam-free',
]);
const MODEL_ALIASES = new Map([
  ['deepseek-v4.1-flash-free', 'deepseek-v4.1-flash-free'],
  ['deepseek', 'deepseek-v4.1-flash-free'],
  ['big-pickle', 'big-pickle'],
  ['big pickle', 'big-pickle'],
  ['pickle', 'big-pickle'],
  ['beam', 'beam-free'],
  ['beam-free', 'beam-free'],
]);

function normalizeOpenCodeModel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().toLowerCase().replace(/^opencode[/:]/, '');
  const model = MODEL_ALIASES.get(raw);
  return model && OPENCODE_MODELS.has(model) ? model : null;
}

Deno.serve(async (req) => {
  const options = preflight(req);
  if (options) return options;
  if (req.method !== 'POST') return fail('METHOD_NOT_ALLOWED', 405);

  const authorization = req.headers.get('Authorization') ?? '';
  const accessToken = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : '';
  if (!accessToken) return fail('AUTH_REQUIRED', 401);

  let body: StartRunBody;
  try {
    body = await req.json() as StartRunBody;
  } catch {
    return fail('INVALID_JSON', 400);
  }

  const siteId = typeof body.siteId === 'string' ? body.siteId.trim() : '';
  if (!siteId) return fail('SITE_ID_REQUIRED', 400);

  const caseIds = Array.isArray(body.caseIds)
    ? body.caseIds.filter((value): value is string =>
      typeof value === 'string' && value.length > 0
    )
    : null;
  if (caseIds !== null && caseIds.length === 0) {
    return fail('CASES_REQUIRED', 400);
  }

  const trigger = typeof body.trigger === 'string' && VALID_TRIGGERS.has(body.trigger)
    ? body.trigger
    : 'manual';
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((value): value is string =>
      typeof value === 'string' && value.length > 0
    ).slice(0, 20)
    : [];

  const service = serviceClient();

  // Vérifie le JWT et récupère l'utilisateur.
  const { data: userData, error: userError } = await service.auth.getUser(accessToken);
  if (userError || !userData.user) return fail('AUTH_INVALID', 401);

  // La lecture passe par le client utilisateur : la RLS garantit l'appartenance.
  const user = userClient(accessToken);
  const { data: site, error: siteError } = await user
    .from('sites')
    .select('id, org_id, name, slug, site_url')
    .eq('id', siteId)
    .maybeSingle();

  if (siteError) return fail('SITE_QUERY_FAILED', 500, siteError.message);
  if (!site?.org_id) return fail('SITE_NOT_FOUND', 404);

  const { data: integration, error: integrationError } = await user
    .from('github_integrations')
    .select('repo_full_name, workflow_file, default_branch, installation_id')
    .eq('org_id', site.org_id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (integrationError) {
    return fail('GITHUB_QUERY_FAILED', 500, integrationError.message);
  }
  if (!integration) return fail('GITHUB_NOT_CONFIGURED', 409);
  if (!integration.installation_id) {
    return fail('GITHUB_INSTALLATION_MISSING', 409);
  }

  const { data: created, error: createError } = await service.rpc(
    'create_run_manifest',
    {
      p_site_id: siteId,
      p_case_ids: caseIds,
      p_trigger: trigger,
      p_branch: body.branch ?? null,
      p_environment: body.environment ?? null,
      p_commit_sha: body.commitSha ?? null,
      p_commit_message: body.commitMessage ?? null,
      p_author: userData.user.email ?? null,
      p_pr_number: body.prNumber ?? null,
      p_tags: tags,
    },
  );

  if (createError) {
    const message = createError.message ?? '';
    if (message.includes('NO_ACTIVE_PLAN')) return fail('NO_ACTIVE_PLAN', 409);
    if (message.includes('NO_CASES_SELECTED')) {
      return fail('NO_CASES_SELECTED', 409);
    }
    if (message.includes('CASE_NOT_IN_PLAN')) {
      return fail('CASE_NOT_IN_PLAN', 409);
    }
    if (message.includes('PROJECT_NOT_FOUND')) {
      return fail('SITE_NOT_FOUND', 404);
    }
    return fail('RUN_CREATE_FAILED', 500, message);
  }

  const runId = created?.runId as string;
  const runToken = created?.token as string;
  if (!runId || !runToken) return fail('RUN_CREATE_FAILED', 500);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const manifestUrl = `${supabaseUrl}/functions/v1/run-manifest?run_id=${runId}`;
  const reportUrl = `${supabaseUrl}/functions/v1/report-run`;
  const configuredModel = normalizeOpenCodeModel(
    Deno.env.get('OPENCODE_MODEL') ?? Deno.env.get('ANTIGRAVITY_MODEL'),
  );
  const model = normalizeOpenCodeModel(body.model)
    ?? configuredModel
    ?? 'big-pickle';

  // fastbrowse est l'exécuteur par défaut. Antigravity reste disponible en
  // fallback explicite ; WebMCP/Playwright a son propre workflow ; IronBee
  // n'est plus déclenché.
  const executor = body.executor === 'antigravity'
    ? 'antigravity'
    : body.executor === 'webmcp'
      ? 'webmcp'
      : 'fastbrowse';
  const workflowFile = executor === 'fastbrowse'
    ? 'fastbrowse-qa.yml'
    : executor === 'webmcp'
      ? 'webmcp-qa.yml'
      : integration.workflow_file || 'antigravity-qa.yml';

  // Le manifeste SQL reste figé sur son ancien libellé ; on aligne la ligne du
  // run tout de suite pour que l'UI et les rapports partiels soient cohérents.
  await service.from('test_runs').update({ executor }).eq('id', runId);
  const inputs: Record<string, string> = {
    qa_run_id: runId,
    manifest_url: manifestUrl,
    run_token: runToken,
    report_url: reportUrl,
    target_url: site.site_url ?? '',
  };
  // Les preuves vidéo ne concernent que l'exécuteur Playwright/WebMCP.
  if (executor === 'webmcp') {
    inputs.evidence_upload_url = `${supabaseUrl}/functions/v1/upload-evidence`;
  }
  if (executor === 'antigravity') inputs.model = model;

  try {
    const githubToken = await installationToken(Number(integration.installation_id));
    await dispatchWorkflow({
      token: githubToken,
      repoFullName: integration.repo_full_name,
      workflowFile,
      ref: integration.default_branch || 'main',
      inputs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await service
      .from('test_runs')
      .update({
        status: 'error',
        finished_at: new Date().toISOString(),
        error_message: message.slice(0, 1000),
      })
      .eq('id', runId);
    await service
      .from('ci_run_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('run_id', runId);

    return fail('GITHUB_DISPATCH_FAILED', 502, message.slice(0, 500));
  }

  // Le jeton n'est jamais renvoyé au navigateur : il ne vit que dans l'input
  // chiffré du workflow GitHub.
  return json({
    runId,
    runNumber: created?.runNumber ?? null,
    expiresAt: created?.expiresAt ?? null,
  }, 201);
});
