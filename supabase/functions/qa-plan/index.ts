/**
 * qa-plan — relais du planificateur LLM pour les runs QA.
 *
 * Le runner Playwright décrit ce qu'il veut demander (messages, modèle,
 * température) ; cette fonction ajoute la clé du fournisseur, côté serveur,
 * et renvoie le contenu brut du modèle. Le runner garde tout le reste : les
 * faits observés, le filtrage des assertions et le scénario déterministe.
 *
 * Pourquoi un relais : la clé LLM ne doit pas circuler dans un workflow
 * GitHub ni dans les entrées d'un run. Seul le jeton éphémère du run est
 * nécessaire, et il expire avec lui.
 */
import { fail, json, preflight } from '../_shared/http.ts';
import { serviceClient, sha256Hex } from '../_shared/supabase.ts';

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 90_000;
const MAX_TOKENS = 8192;

type Provider = {
  label: string;
  endpoint: string;
  key: string;
  model: string;
};

function providerFromEnv(): Provider | null {
  const preferred = (Deno.env.get('QA_PLAN_PROVIDER') ?? 'openrouter').toLowerCase();
  const openrouter = Deno.env.get('OPENROUTER_API_KEY');
  const opencode = Deno.env.get('OPENCODE_API_KEY');

  const openrouterProvider: Provider | null = openrouter
    ? {
        label: 'openrouter',
        endpoint: (Deno.env.get('OPENROUTER_BASE_URL') ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
        key: openrouter,
        model: Deno.env.get('QA_PLAN_MODEL') ?? 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
      }
    : null;

  const opencodeProvider: Provider | null = opencode
    ? {
        label: 'opencode',
        endpoint: (Deno.env.get('OPENCODE_BASE_URL') ?? 'https://opencode.ai/inference/openai/v1').replace(/\/+$/, ''),
        key: opencode,
        model: Deno.env.get('QA_PLAN_MODEL') ?? 'deepseek-v4.1-flash',
      }
    : null;

  if (preferred === 'opencode') return opencodeProvider ?? openrouterProvider;
  return openrouterProvider ?? opencodeProvider;
}

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
  if (raw.length > MAX_BYTES) return fail('PLAN_TOO_LARGE', 413);

  let body: Record<string, unknown>;
  try {
    const parsed = asObject(JSON.parse(raw));
    if (!parsed) return fail('BODY_INVALID', 400, 'objet JSON attendu');
    body = parsed;
  } catch {
    return fail('BODY_INVALID', 400, 'JSON invalide');
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return fail('MESSAGES_REQUIRED', 400);

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

  const provider = providerFromEnv();
  if (!provider) return fail('PLAN_PROVIDER_MISSING', 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${provider.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify({
        model: typeof body.model === 'string' && body.model ? body.model : provider.model,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0,
        max_tokens: Math.min(Number(body.max_tokens ?? MAX_TOKENS) || MAX_TOKENS, MAX_TOKENS),
        messages,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail('PLAN_UPSTREAM_UNREACHABLE', 502, message.slice(0, 300));
  } finally {
    clearTimeout(timer);
  }

  const rawBody = await response.text();
  let payload: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(rawBody);
    payload = asObject(parsed);
  } catch {
    return fail(
      'PLAN_UPSTREAM_INVALID',
      502,
      `HTTP ${response.status} · ${rawBody.slice(0, 300)}`,
    );
  }
  if (!response.ok) {
    const message =
      (payload as { error?: { message?: string } } | null)?.error?.message ??
      `HTTP ${response.status}`;
    return fail('PLAN_UPSTREAM_REFUSED', 502, message.slice(0, 300));
  }
  if (!payload) {
    return fail('PLAN_UPSTREAM_INVALID', 502, `HTTP ${response.status} · corps vide`);
  }

  const choices = payload.choices as
    | Array<{ message?: { content?: string }; finish_reason?: string }>
    | undefined;
  const choice = Array.isArray(choices) ? choices[0] : undefined;
  // Un fournisseur peut répondre 200 sans contenu (quota, filtre, panne
  // amont) : mieux vaut le dire que renvoyer un plan vide.
  if (!choice || !(choice.message?.content ?? '').trim()) {
    return fail(
      'PLAN_UPSTREAM_EMPTY',
      502,
      `HTTP ${response.status} · ${rawBody.slice(0, 300)}`,
    );
  }

  return json({
    provider: provider.label,
    model: typeof payload.model === 'string' ? payload.model : provider.model,
    content: choice?.message?.content ?? '',
    finish_reason: choice?.finish_reason ?? null,
    usage: payload.usage ?? null,
  });
});
