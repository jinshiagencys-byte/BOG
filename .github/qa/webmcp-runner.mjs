#!/usr/bin/env node
/**
 * Runner QA WebMCP — architecture Playwright.
 *
 * Ce runner est distinct de `fastbrowse-runner.mjs` : il ne lance ni fastbrowse,
 * ni LLM, ni Jev. Playwright ouvre Chrome, la page expose ses outils WebMCP,
 * le runner les exécute et applique ses propres assertions.
 *
 * Entrées :
 *   RUN_MANIFEST   manifeste du run (cases) ou WEBMCP_DEMO_MANIFEST
 *   WEBMCP_CASES   catalogue des objectifs (tool, args, expect)
 *   TARGET_URL     URL par défaut
 *   CASE_CODES     filtre optionnel sur les codes
 *   QA_OUTPUT      fichier qa_result.json
 *   REPORT_URL / RUN_TOKEN  rapport vers l'Edge Function report-run
 *
 * Un cas sans `webmcp.tool` est `blocked / not-webmcp` : ce workflow ne doit
 * recevoir que des cas instrumentés.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openProbe } from './page-probe.mjs'
import { runWebMcpTool } from './webmcp-executor.mjs'
import { runPlaywrightScenario } from './playwright-executor.mjs'
import { exploreSite, parsePrice } from './site-explorer.mjs'
import { enrichCases } from './case-enricher.mjs'
import { planCases } from './case-planner.mjs'
import { perchAvailable, planWithPerch } from './perch-planner.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

function env(name, fallback = '') {
  return process.env[name] ?? fallback
}

function readJson(file, fallback) {
  if (!file || !existsSync(file)) return fallback
  return JSON.parse(readFileSync(file, 'utf8'))
}

function expandEnv(value) {
  if (typeof value !== 'string') return value
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] ?? '')
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function cleanText(value, max = 700) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function formatMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'non mesuré'
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`
}

/**
 * Dépose la vidéo du cas dans le bucket privé, via le jeton du run. Un échec
 * d'upload ne change pas le verdict : la vidéo reste une preuve complémentaire
 * et l'artefact CI la conserve.
 */
async function uploadEvidence(code, file) {
  if (!EVIDENCE_UPLOAD_URL || !RUN_TOKEN || !file || !existsSync(file)) return null
  try {
    const bytes = readFileSync(file)
    const response = await fetch(EVIDENCE_UPLOAD_URL, {
      method: 'POST',
      headers: {
        'x-run-token': RUN_TOKEN,
        'x-case-code': code,
        'content-type': 'video/webm',
      },
      body: bytes,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload?.path) {
      console.log(
        `  ⚠ vidéo non archivée : ${payload?.error ?? `HTTP ${response.status}`}`,
      )
      return null
    }
    return payload.path
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`  ⚠ vidéo non archivée : ${message.slice(0, 200)}`)
    return null
  }
}

const ROOT = resolve(env('QA_ROOT', join(HERE, '..', '..')))
// Une variable définie mais vide (workflow_dispatch sans manifeste) vaut absente.
const MANIFEST_PATH = env('RUN_MANIFEST') || env('WEBMCP_DEMO_MANIFEST')
const MANIFEST_FILE = MANIFEST_PATH ? resolve(MANIFEST_PATH) : ''
const GOALS_FILE = resolve(env('WEBMCP_CASES', join(HERE, 'fastbrowse-cases.json')))
const OUTPUT_FILE = resolve(env('QA_OUTPUT', join(ROOT, 'qa_result.json')))
const TARGET_URL = env('TARGET_URL', 'http://127.0.0.1:4173/webmcp-demo.html')
const CASE_DELAY_MS = Number(env('WEBMCP_DELAY_MS', '0'))
const VIDEO_DIR = env('WEBMCP_VIDEO_DIR') ? resolve(env('WEBMCP_VIDEO_DIR')) : null
const VIDEO_TAIL_MS = Number(env('WEBMCP_VIDEO_TAIL_MS', '700'))
const EVIDENCE_UPLOAD_URL = env('EVIDENCE_UPLOAD_URL')
const PROFILE_SAVE_URL = env('PROFILE_SAVE_URL')
// Relais serveur du plan LLM : la clé du fournisseur reste côté Supabase.
const PLAN_URL = env('PLAN_URL')
const EXPLORE_MODE = env('WEBMCP_EXPLORE', 'auto')
const RUN_TOKEN = env('RUN_TOKEN')
// Session optionnelle (site derrière une connexion) : les cas et
// l'exploration doivent voir le même état.
const DEFAULT_STORAGE_STATE = expandEnv(env('WEBMCP_STORAGE_STATE')) || null
// Plan LLM : schéma de ce qui sera vérifié. Il ne fournit ni sélecteur ni
// script ; le scénario exécuté reste déterministe.
const PLAN_MODE = env('WEBMCP_PLAN', 'auto')

/** Fournisseurs LLM disponibles, essayés dans l’ordre. */
function planProviders() {
  const providers = []
  // Un endpoint explicitement configuré passe en premier : c'est le choix de
  // l'opérateur (aujourd'hui TokenHarbor, compatible OpenAI).
  if (env('WEBMCP_PLAN_ENDPOINT')) {
    providers.push({
      label: env('WEBMCP_PLAN_LABEL', 'plan'),
      endpoint: env('WEBMCP_PLAN_ENDPOINT'),
      key: env('WEBMCP_PLAN_KEY') || env('OPENCODE_API_KEY') || env('OPENROUTER_API_KEY'),
      model: env('WEBMCP_PLAN_MODEL', 'deepseek-v4.1-flash'),
    })
  }
  // Perch ensuite : ses modèles frontier sont fournis par l'abonnement, sans
  // clé à exposer. Le CLI doit être installé et une session fournie, sinon le
  // fournisseur n'est pas enregistré.
  if (perchAvailable()) {
    providers.push({ label: 'perch', perch: true })
  }
  // Puis le relais serveur : il détient la clé et n’expose rien dans le
  // workflow.
  if (PLAN_URL && RUN_TOKEN) {
    providers.push({ label: 'relais', proxy: { url: PLAN_URL, token: RUN_TOKEN } })
  }
  if (env('OPENCODE_API_KEY')) {
    providers.push({
      label: 'opencode',
      endpoint: env('OPENCODE_BASE_URL', 'https://opencode.ai/inference/openai/v1'),
      key: env('OPENCODE_API_KEY'),
      model: env('OPENCODE_MODEL', 'deepseek-v4.1-flash'),
    })
  }
  if (env('OPENROUTER_API_KEY')) {
    providers.push({
      label: 'openrouter',
      endpoint: env('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
      key: env('OPENROUTER_API_KEY'),
      model: env('OPENROUTER_MODEL', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free'),
    })
  }
  // Un même fournisseur ne doit pas être tenté deux fois.
  const seen = new Set()
  return providers.filter((provider) => {
    if (provider.perch) return true
    const id = provider.proxy ? `proxy|${provider.proxy.url}` : `${provider.endpoint}|${provider.model}`
    if (!provider.proxy && !provider.key) return false
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}
const ONLY = env('CASE_CODES', '').split(',').map((value) => value.trim()).filter(Boolean)

const goals = readJson(GOALS_FILE, {})
const manifest = readJson(MANIFEST_FILE, null)
if (!manifest) {
  console.error(`Manifeste introuvable : ${MANIFEST_FILE || '(non fourni)'}`)
  process.exit(2)
}

function normaliseSteps(c) {
  const raw = Array.isArray(c.steps) ? c.steps : Array.isArray(c.test_steps) ? c.test_steps : []
  return raw.map((step, index) => ({
    n: step.n ?? step.position ?? index + 1,
    action: step.action ?? '',
    expected: step.expected ?? '',
  }))
}

function normaliseCase(c) {
  return {
    id: c.id ?? null,
    code: c.code ?? c.id ?? '',
    title: c.title ?? c.code ?? '',
    category: c.category ?? null,
    suite: c.suite ?? null,
    description: c.description ?? '',
    discovered: c.discovered === true || c.source === 'discovered',
    severity: c.severity ?? null,
    steps: normaliseSteps(c),
  }
}

const cases = (manifest.cases ?? [])
  .map(normaliseCase)
  .filter((c) => c.code && (!ONLY.length || ONLY.includes(c.code)))

if (!cases.length) {
  console.error('Aucun cas à exécuter dans le manifeste.')
  process.exit(2)
}

// Profil d'exploration : fourni par le manifeste s'il a moins de sept jours,
// sinon construit ici avant d'exécuter. Les cas sans objectif explicite en
// dérivent un scénario concret (vrais produits, vrais prix, vrais libellés).
let profile = manifest.profile && typeof manifest.profile === 'object' && !Array.isArray(manifest.profile)
  ? manifest.profile
  : null
let enrichments = manifest.enrichments && typeof manifest.enrichments === 'object' && !Array.isArray(manifest.enrichments)
  ? manifest.enrichments
  : {}
const profileMeta = manifest.profile_meta ?? null
let generatedSpecs = {}
let overlays = {}

function applyEnrichments({ rebuild = false, llmPlan = null } = {}) {
  if (!profile) return
  const result = enrichCases({ profile, cases, llmPlan })
  generatedSpecs = result.specs
  // Une exploration fraîche remplace les enrichissements ; un profil réutilisé
  // garde ceux qui ont été enregistrés avec lui (mêmes faits, même version).
  if (rebuild || !Object.keys(enrichments).length) enrichments = result.overlays
  overlays = enrichments
  for (const c of cases) {
    const overlay = overlays[c.code]
    if (!overlay?.steps?.length) continue
    c.originalSteps = c.steps
    c.steps = overlay.steps.map((step, index) => ({
      n: index + 1,
      action: step.action ?? '',
      expected: step.expected ?? '',
    }))
    c.enriched = true
  }
  if (result.skipped.length) {
    console.log(
      `  ${result.skipped.length} cas sans données suffisantes : ${result.skipped
        .map((item) => item.code)
        .join(', ')}`,
    )
  }
}

/** Demande au LLM un schéma de vérification, à partir des faits observés. */
async function planFor(siteProfile) {
  if (PLAN_MODE === 'off') return null
  const providers = planProviders()
  if (!providers.length) {
    if (PLAN_MODE === 'on') console.log('  ⚠ plan LLM demandé mais aucun fournisseur disponible')
    return null
  }
  for (const provider of providers) {
    // Un modèle gratuit sature vite : une seconde tentative suffit souvent.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        if (provider.perch) {
          const result = await planWithPerch({
            profile: siteProfile,
            cases,
            timeoutMs: Number(env('PERCH_TIMEOUT_MS', '240000')),
          })
          console.log(`  🧠 plan LLM : ${Object.keys(result.plan).length} cas (${result.model})`)
          return result.plan
        }
        const result = await planCases(
          provider.proxy
            ? { profile: siteProfile, cases, proxy: provider.proxy, timeoutMs: 90000 }
            : {
                profile: siteProfile,
                cases,
                endpoint: provider.endpoint,
                apiKey: provider.key,
                model: provider.model,
                timeoutMs: 90000,
              },
        )
        console.log(
          `  🧠 plan LLM : ${Object.keys(result.plan).length} cas (${result.model})`,
        )
        return result.plan
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const retry = attempt === 1
        console.log(
          `  ⚠ plan LLM ${provider.label}${retry ? ' (nouvel essai)' : ''} : ${message.slice(0, 200)}`,
        )
        if (!retry) break
        await new Promise((resolve) => setTimeout(resolve, 4000))
      }
    }
  }
  // Tous les fournisseurs ont échoué : le scénario déterministe reste valable.
  return null
}

function explorationWanted() {
  if (EXPLORE_MODE === 'off') return false
  if (!/^https?:\/\//i.test(TARGET_URL)) return false
  if (EXPLORE_MODE === 'force') return true
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(TARGET_URL)) return false
  const fresh = profileMeta?.fresh === true && profile
  if (fresh && Object.keys(enrichments).length) return false
  // Sans objectif explicite, le cas a besoin du profil pour exister.
  return cases.some((c) => !goals[c.code])
}

/** Enregistre le profil et ses enrichissements. Un échec ne change pas le run. */
async function saveSiteProfile(siteProfile, overlaySet, source = 'crawler') {
  if (!PROFILE_SAVE_URL || !RUN_TOKEN || !siteProfile) return null
  try {
    const response = await fetch(PROFILE_SAVE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-run-token': RUN_TOKEN },
      body: JSON.stringify({
        profile: siteProfile,
        enrichments: overlaySet,
        status: siteProfile.status,
        source,
        issues: siteProfile.issues ?? [],
        error: null,
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      console.log(`  ⚠ profil non enregistré : ${payload?.error ?? `HTTP ${response.status}`}`)
      return null
    }
    return payload
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`  ⚠ profil non enregistré : ${message.slice(0, 200)}`)
    return null
  }
}

// Deux familles de cas :
//   • webmcp    — la page expose l’outil, on l’exécute ;
//   • playwright — on rejoue une suite d’actions déterministes sur un site réel.
function specFor(c) {
  const configured = goals[c.code]

  const webmcp = configured?.webmcp
  if (webmcp?.tool) {
    return {
      kind: 'webmcp',
      tool: webmcp.tool,
      args: webmcp.args ?? {},
      confirm: webmcp.confirm === true,
      waitMs: webmcp.waitMs,
      timeoutMs: webmcp.timeoutMs,
      url: expandEnv(webmcp.url || configured.webmcpUrl || configured.url || TARGET_URL),
      storageState: expandEnv(webmcp.storageState ?? configured.storageState ?? DEFAULT_STORAGE_STATE ?? '') || null,
      expect: webmcp.expect ?? {},
      label: configured.label || `l’outil ${webmcp.tool}`,
    }
  }

  const scenario = configured?.playwright
  if (scenario?.steps?.length) {
    return {
      kind: 'playwright',
      steps: scenario.steps,
      waitMs: scenario.waitMs,
      timeoutMs: scenario.timeoutMs,
      url: expandEnv(scenario.url || configured.url || TARGET_URL),
      storageState: expandEnv(scenario.storageState ?? configured.storageState ?? DEFAULT_STORAGE_STATE ?? '') || null,
      expect: scenario.expect ?? configured.expect ?? {},
      label: configured.label || `le scénario ${c.code}`,
    }
  }

  // Cas sans objectif écrit à la main : le scénario vient du profil du site.
  const generated = generatedSpecs[c.code]
  if (generated) {
    return {
      kind: generated.kind ?? 'playwright',
      steps: generated.steps ?? [],
      expect: generated.expect ?? {},
      label: generated.label || `le scénario ${c.code}`,
      url: expandEnv(generated.url || profile?.site?.url || TARGET_URL),
      storageState: expandEnv(generated.storageState ?? DEFAULT_STORAGE_STATE ?? '') || null,
      waitMs: generated.waitMs,
      timeoutMs: generated.timeoutMs,
    }
  }

  return null
}

function verifyWebMcp(spec, execution) {
  const text = String(execution.text ?? '')
  const response = execution.result ?? null
  const url = execution.url ?? ''
  const expect = spec.expect ?? {}
  const textChecks = (expect.text ?? []).map((pattern) => ({
    pattern,
    ok: new RegExp(pattern, 'i').test(text),
  }))
  const negativeChecks = (expect.failIfText ?? []).map((pattern) => ({
    pattern,
    matched: new RegExp(pattern, 'i').test(text),
  }))
  const negative = negativeChecks.find((check) => check.matched)?.pattern ?? null
  const urlOk = !expect.url || new RegExp(expect.url, 'i').test(url)
  // Les vérifications de valeurs collectées concernent surtout les scénarios,
  // mais le verdict doit garder la même forme des deux côtés.
  const collectedChecks = checkCollected(expect, execution)

  let parsed = response
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      parsed = response
    }
  }
  const cancelled = parsed && typeof parsed === 'object' && parsed.cancelled === true
  const expectCancelled = expect.cancelled === true
  const missingTexts = textChecks.filter((check) => !check.ok).map((check) => check.pattern)
  const excerpt = cleanText(text, 1200)
  const label = spec.label || `l’outil ${spec.tool}`
  const error = cleanText(execution.error, 500)
  const networkLike = /timeout|net::|econn|fetch failed|failed to fetch|network/i.test(error)

  let status = 'passed'
  let reason = 'tool-result'
  let actual = `Attendu observé : ${label}. L’outil ${spec.tool} a répondu en ${formatMs(execution.durationMs)}.`

  if (!execution.available) {
    status = 'blocked'
    reason = 'probe-unavailable'
    actual = `Sonde de page indisponible : ${error || 'raison inconnue'}.`
  } else if (!execution.ok) {
    const toolMissing = /Outil WebMCP introuvable/.test(execution.error ?? '')
    status = toolMissing || networkLike ? 'blocked' : 'failed'
    reason = toolMissing ? 'tool-missing' : networkLike ? 'network' : 'tool-error'
    actual = toolMissing
      ? `L’outil ${spec.tool} n’est pas exposé par la page ${url}. Outils détectés : ${(execution.tools ?? []).join(', ') || 'aucun'}.`
      : `L’outil ${spec.tool} a échoué : « ${error} ».`
  } else if (cancelled && expectCancelled) {
    status = 'passed'
    reason = 'confirmation-refused'
    actual = `Comportement attendu : la mutation ${spec.tool} est refusée sans confirmation.${execution.dialog ? ` Dialogue : « ${execution.dialog.message} ».` : ''}`
  } else if (cancelled) {
    status = 'failed'
    reason = 'confirmation-refused'
    actual = `L’outil ${spec.tool} a été annulé : la confirmation demandée n’a pas été acceptée.${execution.dialog ? ` Dialogue : « ${execution.dialog.message} ».` : ''} Réponse : « ${excerpt} ».`
  } else if (expectCancelled) {
    status = 'failed'
    reason = 'mutation-not-refused'
    actual = `La mutation ${spec.tool} devait être refusée sans confirmation, mais elle a abouti : « ${excerpt} ».`
  } else if (negative) {
    status = 'failed'
    reason = 'negative-evidence'
    actual = `Le résultat contient « ${negative} » au lieu de ${label}. Réponse : « ${excerpt} ».`
  } else if (missingTexts.length) {
    status = 'failed'
    reason = 'content-missing'
    actual = `Le résultat de ${spec.tool} ne contient pas ${missingTexts.map((pattern) => `« ${pattern} »`).join(', ')}. Réponse : « ${excerpt} ».`
  } else if (!urlOk) {
    status = 'failed'
    reason = 'expectation-mismatch'
    actual = `L’outil ${spec.tool} s’est exécuté sur ${url}, qui ne correspond pas à « ${expect.url} ».`
  } else if (expect.dialog === true && !execution.dialog) {
    status = 'failed'
    reason = 'missing-confirmation'
    actual = `Aucune confirmation visible n’a été demandée pour ${spec.tool}, alors qu’une mutation doit rester sous contrôle de l’utilisateur.`
  }

  if (status === 'passed') {
    actual += textChecks.length
      ? ` Vérifié : ${textChecks.map((check) => `« ${check.pattern} »`).join(', ')}.`
      : reason === 'confirmation-refused'
        ? ''
        : ' Aucune assertion de texte demandée.'
    if (execution.dialog && reason !== 'confirmation-refused') {
      actual += ` Confirmation visible : « ${execution.dialog.message} ».`
    }
  }

  return {
    status,
    reason,
    urlOk,
    textOk: textChecks.every((check) => check.ok),
    textChecks,
    negativeChecks,
    collectedChecks,
    hasNegativeEvidence: Boolean(negative),
    cancelled,
    finalUrl: url,
    pages: url ? [{ url, title: spec.tool, excerpt }] : [],
    excerpt,
    missingTexts,
    actual,
    execution,
  }
}

/** Vérifications fonctionnelles : valeurs réellement collectées dans la page. */
function checkCollected(expect, execution) {
  const rules = expect.collected ?? {}
  const collected = execution.collected ?? {}
  const checks = []
  for (const [name, rule] of Object.entries(rules)) {
    const raw = collected[name]
    const values = (Array.isArray(raw) ? raw : [])
      .map((value) => (typeof value === 'number' ? value : parsePrice(String(value))))
      .filter((value) => Number.isFinite(value) && value > 0)
    const minCount = Number(rule.minCount ?? 1)
    let ok = values.length >= minCount
    if (ok && rule.ordered) {
      ok = values.every((value, index) =>
        index === 0
          ? true
          : rule.ordered === 'asc'
            ? value >= values[index - 1]
            : value <= values[index - 1],
      )
    }
    checks.push({
      name,
      ok,
      count: values.length,
      ordered: rule.ordered ?? null,
      values: values.slice(0, 12),
    })
  }
  return checks
}

function verifyPlaywright(spec, execution) {
  const text = String(execution.text ?? '')
  const url = execution.url ?? ''
  const expect = spec.expect ?? {}
  const textChecks = (expect.text ?? []).map((pattern) => ({
    pattern,
    ok: new RegExp(pattern, 'i').test(text),
  }))
  const negativeChecks = (expect.failIfText ?? []).map((pattern) => ({
    pattern,
    matched: new RegExp(pattern, 'i').test(text),
  }))
  const negative = negativeChecks.find((check) => check.matched)?.pattern ?? null
  const urlOk = !expect.url || new RegExp(expect.url, 'i').test(url)
  const missingTexts = textChecks.filter((check) => !check.ok).map((check) => check.pattern)
  const excerpt = cleanText(text, 1200)
  const label = spec.label || 'le scénario'
  const error = cleanText(execution.error, 500)
  // Un délai dépassé n’est pas toujours un problème réseau : un clic qui
  // n’aboutit pas est un défaut d’interface. Seuls le chargement de page et
  // les vraies erreurs réseau restent « bloqués ».
  const navigationTimeout = /page\.goto|waitforurl|waiting for navigation|navigation/i.test(error)
  const networkLike =
    /net::|econn|enotfound|eai_again|etimedout|socket hang up|failed to fetch|fetch failed|err_(internet|connection|name|network|empty_response|timed_out|failed)/i.test(
      error,
    ) || (/timeout/i.test(error) && navigationTimeout)
  const actions = execution.steps ?? []
  const httpErrors = Array.isArray(execution.httpErrors) ? execution.httpErrors : []
  const rateLimited = httpErrors.filter((item) => item.status === 429)
  const collectedChecks = checkCollected(expect, execution)
  const failedCollected = collectedChecks.find((check) => !check.ok) ?? null
  const visibleChecks = Array.isArray(execution.visibleChecks) ? execution.visibleChecks : []
  const hidden = visibleChecks.find((check) => check.found > 0 && (!check.visible || !check.inViewport)) ?? null

  let status = 'passed'
  let reason = 'scenario'
  let actual = `Attendu observé : ${label}. ${actions.length} action(s) Playwright en ${formatMs(execution.durationMs)} sur ${url}.`

  if (!execution.available) {
    status = 'blocked'
    reason = 'probe-unavailable'
    actual = `Navigateur indisponible : ${error || 'raison inconnue'}.`
  } else if (rateLimited.length) {
    // Le quota de l'API n'est pas un défaut du produit : on ne le compte pas
    // comme un échec, mais le cas n'a pas pu être vérifié.
    status = 'blocked'
    reason = 'rate-limited'
    actual = `Le site a répondu 429 (quota) sur ${rateLimited.length} requête(s), dont ${rateLimited[0].url}. Le cas n’a pas pu être vérifié.`
  } else if (!execution.ok) {
    status = networkLike ? 'blocked' : 'failed'
    reason = networkLike ? 'network' : 'step-failed'
    actual = `Le scénario a échoué : ${error}. Dernière URL : ${url || 'aucune'}.`
  } else if (negative) {
    status = 'failed'
    reason = 'negative-evidence'
    actual = `La page contient « ${negative} » au lieu de ${label}. URL : ${url}. Extrait : « ${excerpt} ».`
  } else if (missingTexts.length) {
    status = 'failed'
    reason = 'content-missing'
    actual = `Le texte attendu (${label}) est absent : ${missingTexts.map((pattern) => `« ${pattern} »`).join(', ')}. URL : ${url}. Extrait : « ${excerpt} ».`
  } else if (!urlOk) {
    status = 'failed'
    reason = 'expectation-mismatch'
    actual = `Le scénario s’est terminé sur ${url}, qui ne correspond pas à « ${expect.url} ». Extrait : « ${excerpt} ».`
  } else if (hidden) {
    status = 'failed'
    reason = 'not-visible'
    actual = `Le texte « ${hidden.pattern} » existe dans la page mais n’est pas visible à l’écran après défilement (trouvé : ${hidden.found}, visible : ${hidden.visible}, dans la fenêtre : ${hidden.inViewport}). URL : ${url}.`
  } else if (failedCollected) {
    status = 'failed'
    reason = 'collected-check'
    actual = `Vérification fonctionnelle échouée : ${failedCollected.name} attendait au moins ${
      expect.collected?.[failedCollected.name]?.minCount ?? 1
    } valeur(s)${failedCollected.ordered ? ` ordonnées (${failedCollected.ordered})` : ''}, obtenu ${
      failedCollected.count
    } (${failedCollected.values.join(', ') || 'aucune'}). URL : ${url}.`
  }

  if (status === 'passed') {
    actual += textChecks.length
      ? ` Vérifié : ${textChecks.map((check) => `« ${check.pattern} »`).join(', ')}.`
      : ' Aucune assertion de texte demandée.'
    for (const check of collectedChecks.filter((item) => item.ok)) {
      actual += ` ${check.name} : ${check.count} valeur(s)${
        check.ordered ? ` ${check.ordered === 'asc' ? 'croissantes' : 'décroissantes'}` : ''
      }.`
    }
  }

  return {
    status,
    reason,
    urlOk,
    textOk: textChecks.every((check) => check.ok),
    textChecks,
    negativeChecks,
    collectedChecks,
    visibleChecks,
    hasNegativeEvidence: Boolean(negative),
    cancelled: false,
    pages: url ? [{ url, title: label, excerpt }] : [],
    finalUrl: url,
    excerpt,
    missingTexts,
    actual,
    execution,
  }
}

function evidenceOf(spec, verdict) {
  const execution = verdict.execution ?? {}
  if (spec.kind === 'playwright') {
    return {
      engine: 'playwright',
      playwright_status: verdict.status,
      playwright_reason: verdict.reason,
      playwright_error: execution.error ?? null,
      playwright_http_errors: execution.httpErrors ?? [],
      playwright_actions: (execution.steps ?? []).map((step) => ({
        n: step.n,
        action: step.action,
        target: step.target,
        ok: step.ok,
        ms: step.ms,
        error: step.error ?? null,
      })),
      video: execution.video ?? null,
      video_path: execution.videoPath ?? null,
      elapsed_ms: execution.durationMs ?? null,
      url: verdict.finalUrl || null,
      final_url: verdict.finalUrl || null,
      expectations: spec.expect ?? {},
      url_ok: verdict.urlOk,
      text_ok: verdict.textOk,
      text_checks: verdict.textChecks,
      negative_checks: verdict.negativeChecks,
      collected_checks: verdict.collectedChecks ?? [],
      visible_checks: verdict.visibleChecks ?? [],
      actual: verdict.actual,
      excerpt: verdict.excerpt,
      pages: verdict.pages.slice(-3).map((page) => ({
        url: page.url,
        title: page.title,
        excerpt: String(page.excerpt ?? '').slice(0, 2500),
      })),
    }
  }
  return {
    engine: 'webmcp',
    webmcp_tool: spec.tool,
    webmcp_args: spec.args,
    webmcp_status: verdict.status,
    webmcp_reason: verdict.reason,
    webmcp_result: execution.result ?? null,
    webmcp_error: execution.error ?? null,
    webmcp_dialog: execution.dialog ?? null,
    webmcp_confirmation_requested: spec.confirm === true,
    webmcp_tools_detected: execution.tools ?? [],
    video: execution.video ?? null,
    video_path: execution.videoPath ?? null,
    elapsed_ms: execution.durationMs ?? null,
    // `url` alimente evidence_url côté base, sans capture d’écran.
    url: verdict.finalUrl || null,
    final_url: verdict.finalUrl || null,
    expectations: spec.expect ?? {},
    url_ok: verdict.urlOk,
    text_ok: verdict.textOk,
    text_checks: verdict.textChecks,
    negative_checks: verdict.negativeChecks,
    actual: verdict.actual,
    excerpt: verdict.excerpt,
    pages: verdict.pages.slice(-3).map((page) => ({
      url: page.url,
      title: page.title,
      excerpt: String(page.excerpt ?? '').slice(0, 2500),
    })),
  }
}

function stepResults(c, verdict, spec) {
  const steps = c.steps.length
    ? c.steps
    : [{ n: 1, action: c.title, expected: 'Le comportement attendu est observé' }]
  const evidence = evidenceOf(spec, verdict)
  // Le schéma du plan (LLM + faits observés) accompagne la preuve : l’écran
  // peut afficher ce qui devait être vérifié, même quand le cas est bloqué.
  const overlay = overlays[c.code]
  if (overlay) {
    evidence.enriched = {
      motif: overlay.motif,
      planner: overlay.source,
      checks: overlay.checks ?? [],
      steps: overlay.steps ?? [],
    }
  }
  if (profile) {
    evidence.site_profile = {
      status: profile.status ?? null,
      captured_at: profile.captured_at ?? null,
      products: Array.isArray(profile.products) ? profile.products.length : 0,
    }
  }
  const executed = spec.kind === 'playwright'
    ? `Scénario Playwright exécuté sur ${verdict.finalUrl || 'une URL inconnue'} en ${formatMs(verdict.execution?.durationMs)} (${(verdict.execution?.steps ?? []).length} action(s)).`
    : `Outil WebMCP « ${spec.tool} » exécuté sur ${verdict.finalUrl || 'une URL inconnue'} en ${formatMs(verdict.execution?.durationMs)}.`

  return steps.map((step, i) => {
    let status = 'passed'
    let actual = ''
    if (verdict.status === 'passed') {
      actual = i === 0 ? executed : verdict.actual
    } else if (verdict.status === 'failed') {
      if (i === 0) {
        actual = executed
      } else if (i === 1) {
        status = 'failed'
        actual = verdict.actual
      } else {
        status = 'skipped'
        actual = 'Non exécutée : l’échec a été constaté avant cette étape.'
      }
    } else if (verdict.status === 'blocked') {
      if (i === 0) {
        status = 'blocked'
        actual = verdict.actual
      } else {
        status = 'skipped'
        actual = 'Non exécutée : le parcours n’a pas pu aboutir.'
      }
    } else {
      status = 'skipped'
      actual = 'Non exécutée.'
    }
    return {
      n: step.n,
      code: `${c.code}-${step.n}`,
      action: step.action,
      expected: step.expected,
      actual: String(actual).slice(0, 2000),
      status,
      evidence,
    }
  })
}

function blockedVerdict(message) {
  return {
    status: 'blocked',
    reason: 'not-instrumented',
    urlOk: false,
    textOk: false,
    textChecks: [],
    negativeChecks: [],
    hasNegativeEvidence: false,
    cancelled: false,
    finalUrl: '',
    pages: [],
    excerpt: '',
    missingTexts: [],
    actual: message,
    execution: { durationMs: 0, tools: [] },
  }
}

const startedAt = new Date()
const results = []
const probeBrowser = await openProbe(env('WEBMCP_PROBE_DIR', process.cwd()))
if (probeBrowser.available) {
  console.log(`\n🎭 Playwright + WebMCP (${probeBrowser.executablePath})`)
} else {
  console.log(`\n⚠ Navigateur indisponible : ${probeBrowser.reason}`)
}

// Exploration avant exécution : une fois par site, renouvelée chaque semaine.
if (probeBrowser.available && explorationWanted()) {
  console.log(`\n🔎 Exploration de ${TARGET_URL}`)
  try {
    const explored = await exploreSite(probeBrowser, {
      url: TARGET_URL,
      storageState: DEFAULT_STORAGE_STATE,
    })
    profile = explored
    console.log(
      `  ${explored.status} · ${explored.products.length} produit(s) · ${Math.round(
        (explored.durationMs ?? 0) / 1000,
      )} s`,
    )
    for (const issue of (explored.issues ?? []).slice(0, 5)) console.log(`  ⚠ ${issue}`)
    const llmPlan = await planFor(explored)
    applyEnrichments({ rebuild: true, llmPlan })
    console.log(`  ${Object.keys(overlays).length} cas enrichi(s) à partir du profil`)
    const saved = await saveSiteProfile(explored, overlays, llmPlan ? 'hybrid' : 'crawler')
    if (saved) {
      console.log(
        `  💾 profil v${saved.version} enregistré (expire le ${String(saved.expires_at).slice(0, 10)})`,
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.log(`  ⚠ exploration impossible : ${message.slice(0, 200)}`)
  }
} else if (profile) {
  console.log(
    `\n🔎 Profil réutilisé (${profileMeta?.captured_at?.slice(0, 10) ?? 'date inconnue'})`,
  )
  applyEnrichments()
}

try {
  for (const [index, c] of cases.entries()) {
    const spec = specFor(c)
    console.log(`\n▶ ${c.code} — ${c.title}`)
    if (index > 0 && CASE_DELAY_MS > 0) {
      console.log(`  … pause ${Math.round(CASE_DELAY_MS / 1000)} s entre les cas`)
      await sleep(CASE_DELAY_MS)
    }

    let verdict
    if (!spec) {
      verdict = blockedVerdict(
        `Aucun objectif WebMCP ou Playwright pour ${c.code}. Ce workflow n’exécute que des cas instrumentés.`,
      )
      console.log(`  BLOCKED (not-instrumented) · ${verdict.actual}`)
      results.push({
        code: c.code,
        title: c.title,
        category: c.category,
        suite: c.suite,
        description: c.description,
        discovered: c.discovered,
        severity: c.severity,
        status: verdict.status,
        note: verdict.actual.slice(0, 4000),
        duration_ms: 0,
        steps: stepResults(c, verdict, { kind: 'webmcp', tool: null, args: {}, expect: {} }),
      })
      continue
    }

    const execution = spec.kind === 'webmcp'
      ? await runWebMcpTool(probeBrowser, {
          url: spec.url,
          tool: spec.tool,
          args: spec.args,
          storageState: spec.storageState,
          confirm: spec.confirm,
          timeoutMs: spec.timeoutMs,
          waitMs: spec.waitMs,
          videoDir: VIDEO_DIR,
          videoName: `${c.code}.webm`,
          videoTailMs: VIDEO_TAIL_MS,
        })
      : await runPlaywrightScenario(probeBrowser, {
          url: spec.url,
          steps: spec.steps,
          storageState: spec.storageState,
          timeoutMs: spec.timeoutMs,
          waitMs: spec.waitMs,
          videoDir: VIDEO_DIR,
          videoName: `${c.code}.webm`,
          videoTailMs: VIDEO_TAIL_MS,
          expect: spec.expect ?? {},
        })

    verdict = spec.kind === 'webmcp'
      ? verifyWebMcp(spec, execution)
      : verifyPlaywright(spec, execution)

    // La vidéo part dans le bucket après le verdict : un échec d'upload ne
    // transforme pas un cas réussi en échec.
    if (execution.video) {
      const archived = await uploadEvidence(c.code, execution.video)
      if (archived) {
        execution.videoPath = archived
        console.log(`  ☁ ${archived}`)
      }
    }

    const executorLabel = spec.kind === 'webmcp'
      ? `outil ${spec.tool}`
      : `scénario ${spec.steps.length} actions`
    console.log(`  ${verdict.status.toUpperCase()} (${verdict.reason}) · ${execution.durationMs} ms · ${executorLabel}`)
    console.log(`  ${verdict.actual.slice(0, 700)}`)
    if (execution.video) console.log(`  🎥 ${execution.video}`)
    results.push({
      code: c.code,
      title: c.title,
      category: c.category,
      suite: c.suite,
      description: c.description,
      discovered: c.discovered,
      severity: c.severity,
      status: verdict.status,
      note: verdict.actual.slice(0, 4000),
      duration_ms: execution.durationMs ?? 0,
      steps: stepResults(c, verdict, spec),
    })
  }
} finally {
  if (probeBrowser.available) await probeBrowser.browser.close().catch(() => {})
}

const counts = { passed: 0, failed: 0, blocked: 0, skipped: 0 }
for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1

const videos = results
  .map((result) => result.steps?.[0]?.evidence?.video)
  .filter(Boolean)

const payload = {
  run_id: env('QA_RUN_ID') || null,
  model: env('WEBMCP_REPORT_MODEL', 'playwright+webmcp'),
  executor: 'webmcp',
  started_at: startedAt.toISOString(),
  finished_at: new Date().toISOString(),
  duration_ms: results.reduce((sum, result) => sum + result.duration_ms, 0),
  cases: results,
  summary: counts,
  videos,
  exploration: profile
    ? {
        status: profile.status ?? null,
        site: profile.site?.url ?? null,
        captured_at: profile.captured_at ?? null,
        profile_version: profileMeta?.version ?? null,
        products: Array.isArray(profile.products) ? profile.products.length : 0,
        enriched_cases: Object.keys(overlays).length,
      }
    : null,
}

mkdirSync(dirname(OUTPUT_FILE), { recursive: true })
writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2))
console.log(`\nRésultat écrit dans ${OUTPUT_FILE}`)
if (videos.length) console.log(`${videos.length} vidéo(s) dans ${VIDEO_DIR}`)
console.log(JSON.stringify(counts))

const reportUrl = env('REPORT_URL')
const runToken = env('RUN_TOKEN')
if (reportUrl && runToken) {
  const body = {
    run_id: payload.run_id,
    model: payload.model,
    executor: payload.executor,
    duration_ms: payload.duration_ms,
    github_run_id: env('GITHUB_RUN_ID') || null,
    github_run_attempt: env('GITHUB_RUN_ATTEMPT') || null,
    github_run_url: env('GITHUB_RUN_URL') || null,
    cases: payload.cases,
  }
  const response = await fetch(reportUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-run-token': runToken },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  console.log(`report-run HTTP ${response.status}: ${text.slice(0, 800)}`)
  if (!response.ok) process.exitCode = 1
}
