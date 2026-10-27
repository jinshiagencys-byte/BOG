#!/usr/bin/env node
/**
 * fastbrowse QA runner.
 *
 * The runner owns the test plan and the assertions. fastbrowse owns the browser
 * task: it plans with the LLM, chooses controls with Jev, and returns the final
 * URL, cited page evidence, step log and cost.
 *
 * This is deliberately not "trust the agent's verdict": a case passes only when
 * our own expectations match fastbrowse's evidence, or when the independent
 * page probe proves the expected content. A case that fastbrowse stopped short
 * of can still pass when the page probe proves the user-visible expectation
 * (for example: "the category page lists products").
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { openProbe, probeUrl } from './page-probe.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

function readEnvFile(file) {
  if (!existsSync(file)) return {}
  const raw = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const i = trimmed.indexOf('=')
    let value = trimmed.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    raw[trimmed.slice(0, i).trim()] = value
  }
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    out[key] = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => (
      out[name] ?? raw[name] ?? process.env[name] ?? ''
    ))
  }
  return out
}

function readJson(file, fallback) {
  if (!file || !existsSync(file)) return fallback
  return JSON.parse(readFileSync(file, 'utf8'))
}

function env(name, fallback = '') {
  return process.env[name] ?? fallback
}

const ROOT = resolve(env('QA_ROOT', join(HERE, '..', '..')))
const FASTBROWSE_DIR = resolve(env('FASTBROWSE_DIR', join(ROOT, '..', 'fastbrowse')))
const LOCAL_CLI = join(FASTBROWSE_DIR, '.venv', 'bin', 'fastbrowse')
const FASTBROWSE_CLI = env('FASTBROWSE_CLI', existsSync(LOCAL_CLI) ? LOCAL_CLI : 'fastbrowse')
const GOALS_FILE = resolve(env('FASTBROWSE_CASES', join(HERE, 'fastbrowse-cases.json')))
const PLAN_FILE = resolve(env('PLAN_FILE', join(ROOT, 'plan-cases.json')))
const MANIFEST_FILE = resolve(env('RUN_MANIFEST', join(ROOT, 'run_manifest.json')))
const OUTPUT_FILE = resolve(env('QA_OUTPUT', join(ROOT, 'qa_result.json')))
const CACHE_DIR = resolve(env('QA_CACHE_DIR', '/tmp/opencode/qa-cache'))
const TARGET_URL = env('TARGET_URL', 'https://odjafrik.com')
const MAX_CASE_MS = Number(env('FASTBROWSE_CASE_TIMEOUT_MS', '120000'))
const REUSE_CACHE = env('FASTBROWSE_REUSE') === '1'
const CASE_DELAY_MS = Number(env('FASTBROWSE_DELAY_MS', '2000'))
const RETRIES = Number(env('FASTBROWSE_RETRIES', '1'))
const RETRY_DELAY_MS = Number(env('FASTBROWSE_RETRY_DELAY_MS', '15000'))
const MAX_STEPS = Number(env('FASTBROWSE_MAX_STEPS', '25'))
const MAX_DOLLARS = Number(env('FASTBROWSE_MAX_DOLLARS', '0.10'))
const ONLY = env('CASE_CODES', '').split(',').map((value) => value.trim()).filter(Boolean)

const fastbrowseEnv = {
  ...readEnvFile(join(FASTBROWSE_DIR, '.env')),
  ...process.env,
}
const openCodeKey = fastbrowseEnv.OPENCODE_API_KEY
  || fastbrowseEnv.TYPESAFE_API_KEY
  || fastbrowseEnv.FASTBROWSE_LLM_API_KEY
  || ''
if (openCodeKey) {
  fastbrowseEnv.OPENCODE_API_KEY = openCodeKey
  fastbrowseEnv.TYPESAFE_API_KEY = openCodeKey
  fastbrowseEnv.FASTBROWSE_LLM_API_KEY = openCodeKey
}
fastbrowseEnv.FASTBROWSE_LLM_BASE_URL ||= 'https://opencode.ai/inference/openai/v1'
fastbrowseEnv.FASTBROWSE_LLM_MODEL ||= 'deepseek-v4.1-flash'
fastbrowseEnv.FASTBROWSE_JEV_SOURCE ||= 'typesafe'
fastbrowseEnv.FASTBROWSE_JEV_BASE_URL ||= 'https://opencode.ai/inference/systemone'
fastbrowseEnv.FASTBROWSE_JEV_MODEL ||= 'jev-1.13'
// Une seule clé, un seul fournisseur : aucun repli silencieux.
delete fastbrowseEnv.OPENROUTER_API_KEY
delete fastbrowseEnv.AI_GATEWAY_API_KEY
delete fastbrowseEnv.BROWSER_USE_API_KEY

if (!openCodeKey) {
  console.error('OPENCODE_API_KEY manquante. Renseigne le secret GitHub OPENCODE_API_KEY.')
  process.exit(2)
}

const goals = readJson(GOALS_FILE, {})
const manifest = readJson(MANIFEST_FILE, null)
const planCases = manifest ? null : readJson(PLAN_FILE, [])
const rawCases = manifest?.cases ?? planCases ?? []

function normaliseSteps(c) {
  if (Array.isArray(c.steps)) {
    return c.steps.map((s, i) => ({
      n: s.n ?? i + 1,
      action: s.action ?? '',
      expected: s.expected ?? '',
    }))
  }
  if (Array.isArray(c.test_steps)) {
    return [...c.test_steps]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((s, i) => ({
        n: s.position ?? i + 1,
        action: s.action ?? '',
        expected: s.expected ?? '',
      }))
  }
  return []
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

const cases = rawCases
  .map(normaliseCase)
  .filter((c) => c.code && (!ONLY.length || ONLY.includes(c.code)))

if (!cases.length) {
  console.error('Aucun cas à exécuter. Vérifie RUN_MANIFEST/PLAN_FILE et CASE_CODES.')
  process.exit(2)
}

function defaultGoal(c) {
  return {
    url: TARGET_URL,
    goal: `On ${TARGET_URL}, verify this test case: "${c.title}". ${c.steps.map((s) => `${s.n}. ${s.action} (attendu: ${s.expected})`).join(' ')} Stop when the page clearly shows the result. Do not perform unrelated actions and do not submit a payment.`,
    label: c.title,
    mapped: false,
    expect: { url: '', text: [], console: 'warn' },
  }
}

function goalFor(c) {
  const configured = goals[c.code]
  return configured ? { ...configured, mapped: true } : defaultGoal(c)
}

function cachePath(code) {
  return join(CACHE_DIR, `${code}.json`)
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

function textOf(json) {
  const chunks = []
  if (json?.answer) chunks.push(json.answer)
  for (const evidence of json?.evidence ?? []) {
    if (evidence?.quote) chunks.push(evidence.quote)
  }
  for (const step of json?.steps ?? []) {
    if (step?.note) chunks.push(step.note)
    for (const fact of step?.facts ?? []) {
      if (fact?.text) chunks.push(fact.text)
      if (fact?.quote) chunks.push(fact.quote)
    }
  }
  if (json?.data != null) chunks.push(JSON.stringify(json.data))
  return chunks.filter(Boolean).join('\n')
}

function pagesOf(json) {
  const pages = new Map()
  const add = (url, title, excerpt) => {
    if (!url) return
    const previous = pages.get(url) ?? { url, title: '', excerpt: '' }
    pages.set(url, {
      url,
      title: previous.title || title || '',
      excerpt: [previous.excerpt, excerpt].filter(Boolean).join('\n').slice(0, 4000),
    })
  }
  for (const step of json?.steps ?? []) add(step.url, step.target, step.note)
  for (const evidence of json?.evidence ?? []) {
    add(evidence.url, (evidence.heading_path ?? []).slice(-2).join(' > '), evidence.quote)
  }
  return [...pages.values()]
}

function finalUrlOf(json) {
  return json?.final_url
    || [...(json?.steps ?? [])].reverse().find((step) => step?.url)?.url
    || [...(json?.evidence ?? [])].reverse().find((item) => item?.url)?.url
    || ''
}

function productCountOf(text) {
  const match = /(\d+)\s+produits?\s+trouvés?/i.exec(String(text ?? ''))
  return match ? Number(match[1]) : null
}

function articleCountOf(text) {
  const match = /(\d+)\s+articles?/i.exec(String(text ?? ''))
  return match ? Number(match[1]) : null
}

function shortConsole(value) {
  const raw = String(value ?? '')
  const firstLine = cleanText(raw.split('\n')[0], 220)
  const file = /https:\/\/[^\s)]+/.exec(raw)?.[0]
  if (!file) return firstLine
  return `${firstLine} (${file.replace(/^https?:\/\/[^/]+\//, '')})`
}

function pageExcerpt(text) {
  const normalized = cleanText(text, 12000)
  if (!normalized) return 'page vide'
  const anchor = normalized.search(/produits?\s+trouvés?|aucun produit|FCFA|En stock|Ajouter|Mon Panier/i)
  if (anchor < 0) return normalized.slice(0, 520)
  const start = Math.max(0, anchor - 100)
  return normalized.slice(start, start + 620)
}

function isSeriousConsole(value) {
  return /NG\d{4}|uncaught|typeerror|referenceerror|ERROR\s+M:|error:/i.test(String(value ?? ''))
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))]
}

function isTransient(value) {
  return /ECONNRESET|ERR_CONNECTION|429|too many requests|failed to load resource|timeout|unavailable|502|503|504/i.test(
    String(value ?? ''),
  )
}

function transientOf(run) {
  const text = `${run.json?.error ?? ''}\n${run.stderr ?? ''}`
  if (!isTransient(text)) return []
  return [{
    source: 'fastbrowse',
    severity: 'minor',
    title: cleanText(run.json?.error || run.stderr || 'fournisseur temporairement indisponible', 240),
    detail: '',
  }]
}

function runFastbrowseOnce(c, goal) {
  const maxSteps = Number(goal.maxSteps ?? MAX_STEPS)
  const maxDollars = Number(goal.maxDollars ?? MAX_DOLLARS)
  const args = [
    goal.goal,
    '--start', goal.url || TARGET_URL,
    '--json',
    '--local',
    '--max-steps', String(maxSteps),
    '--max-dollars', String(maxDollars),
  ]
  if (goal.authorize === true) args.push('--authorize')

  return new Promise((resolvePromise) => {
    const started = performance.now()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const child = spawn(FASTBROWSE_CLI, args, {
      cwd: FASTBROWSE_DIR,
      env: fastbrowseEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, MAX_CASE_MS)

    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      let json = null
      let parseError = null
      try {
        json = JSON.parse(stdout.trim())
      } catch (error) {
        parseError = error.message
      }
      const run = {
        goal,
        exitCode: code,
        timedOut,
        durationMs: Math.round(performance.now() - started),
        json,
        parseError,
        stderr: stderr.slice(-6000),
        cached: false,
      }
      if (json) {
        mkdirSync(CACHE_DIR, { recursive: true })
        writeFileSync(cachePath(c.code), JSON.stringify({
          json,
          stderr: run.stderr,
          durationMs: run.durationMs,
          savedAt: new Date().toISOString(),
        }, null, 2))
      }
      resolvePromise(run)
    }

    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      stderr += `\n${error.message}`
      finish(127)
    })
    child.on('close', (code) => finish(code))
  })
}

async function runFastbrowse(c) {
  const goal = goalFor(c)

  if (REUSE_CACHE && existsSync(cachePath(c.code))) {
    const cached = readJson(cachePath(c.code), null)
    if (cached?.json) {
      return {
        goal,
        exitCode: 0,
        timedOut: false,
        durationMs: cached.durationMs ?? 0,
        json: cached.json,
        parseError: null,
        stderr: cached.stderr ?? '',
        cached: true,
      }
    }
  }

  let run = await runFastbrowseOnce(c, goal)
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    // Ne jamais rejouer un cas qui a produit un verdict et des preuves.
    // Un 429 vu dans une page déjà chargée ne doit pas transformer un échec
    // produit en plusieurs passages de plusieurs minutes.
    const technicalFailure = run.timedOut || !run.json
    if (!technicalFailure) break
    const delay = RETRY_DELAY_MS * attempt
    console.log(`  ↻ tentative ${attempt + 1}/${RETRIES + 1} dans ${Math.round(delay / 1000)} s (sortie fastbrowse incomplète)`)
    await sleep(delay)
    run = await runFastbrowseOnce(c, goal)
  }
  return run
}

async function verify(c, goal, run, probeBrowser) {
  const json = run.json
  const agentSteps = Array.isArray(json?.steps) ? json.steps : []
  const agentEvidence = Array.isArray(json?.evidence) ? json.evidence : []
  const pages = pagesOf(json)
  const text = textOf(json)
  const finalUrl = finalUrlOf(json)
  const agentStatus = json?.status ?? null
  const agentProven = ['complete', 'unverified'].includes(agentStatus)
  const agentError = cleanText(json?.error || '', 500)
  const maxContentMs = goal.perf?.maxContentMs ?? 5000
  const maxWaitMs = goal.perf?.maxWaitMs ?? 15000
  const consolePolicy = goal.expect?.console ?? 'warn'

  const agentUrlOk = !goal.expect?.url
    || new RegExp(goal.expect.url, 'i').test(finalUrl)
    || pages.some((page) => new RegExp(goal.expect.url, 'i').test(page.url ?? ''))
  const textChecks = (goal.expect?.text ?? []).map((pattern) => ({
    pattern,
    ok: new RegExp(pattern, 'i').test(text),
  }))
  const textOk = textChecks.every((check) => check.ok)
  const negativeChecks = (goal.expect?.failIfText ?? []).map((pattern) => ({
    pattern,
    matched: new RegExp(pattern, 'i').test(text),
  }))
  const agentNegative = negativeChecks.find((check) => check.matched)?.pattern ?? null

  const probeWanted = Boolean(goal.probeUrl) || (goal.expect?.text?.length ?? 0) > 0
  const probe = probeBrowser && probeWanted
    ? await probeUrl(probeBrowser, {
        url: goal.probeUrl || finalUrl,
        text: goal.probeText || goal.expect?.text || [],
        failIfText: goal.expect?.failIfText || [],
        maxContentMs,
        maxWaitMs,
      })
    : { available: false, reason: 'aucune cible de sonde définie' }

  const probeUrlOk = probe.available
    && (!goal.expect?.url || new RegExp(goal.expect.url, 'i').test(probe.url ?? ''))
  const urlOk = agentUrlOk || probeUrlOk
  const probeTextChecks = probe.available
    ? (goal.probeText || goal.expect?.text || []).map((pattern) => ({
        pattern,
        ok: new RegExp(pattern, 'i').test(probe.text ?? ''),
      }))
    : []
  const probeTextOk = probe.available ? probe.matched : null
  const probeReloadOk = probe.available ? probe.reloadMatched : null
  const probeContentOk = probe.available
    ? probe.matched && (!goal.probeText || textOk)
    : null
  const contentOk = probe.available ? probeContentOk : textOk
  const evidencePass = probe.available ? contentOk : contentOk && agentProven
  const probeHttpStatus = probe.httpStatus ?? null
  const probeNavFailed = probe.available && (probe.navError || probeHttpStatus === 429 || probeHttpStatus >= 500)
  const probeContentMs = probe.contentMs ?? null
  const probeReloadContentMs = probe.reloadContentMs ?? null
  const slowContent = probe.available && probeContentMs != null && probeContentMs > maxContentMs
  const slowReload = probe.available && probeReloadContentMs != null && probeReloadContentMs > maxContentMs
  const missingTexts = (probe.available ? probeTextChecks : textChecks)
    .filter((check) => !check.ok)
    .map((check) => check.pattern)
  const finalMissingTexts = textChecks.filter((check) => !check.ok).map((check) => check.pattern)
  const productCount = probe.available ? productCountOf(probe.text) : productCountOf(text)
  const agentProductCount = productCountOf(text)
  const articleCount = articleCountOf(text) ?? articleCountOf(probe.text)
  const negative = probe.available ? probe.negative : agentNegative
  const consoleErrors = uniqueStrings(probe.available ? probe.consoleErrors : []).filter(isSeriousConsole)
  const findings = consoleErrors.map((title) => ({
    source: 'console',
    severity: consolePolicy === 'fail' ? 'major' : 'minor',
    title,
    detail: '',
  }))
  const transient = transientOf(run)
  const excerpt = pageExcerpt(probe.text || text)

  let status = 'blocked'
  let reason = 'no-evidence'

  if (!probe.available && run.timedOut) {
    status = 'blocked'
    reason = 'timeout'
  } else if (!probe.available && !json) {
    status = 'blocked'
    reason = run.parseError ? `invalid-json: ${run.parseError}` : 'no-json'
  } else if (probe.available && probeNavFailed) {
    status = 'blocked'
    reason = 'network'
  } else if (probe.available && negative) {
    // The requested page was reached and explicitly says there is no product.
    // A model loop or a minor console warning must not hide that fact.
    status = 'failed'
    reason = 'negative-evidence'
  } else if (probe.available && !probe.matched) {
    status = 'failed'
    reason = 'content-missing'
  } else if (probe.available && !probe.reloadMatched) {
    status = 'failed'
    reason = 'reload-missing'
  } else if (slowContent || slowReload) {
    status = 'failed'
    reason = 'slow-content'
  } else if (!urlOk) {
    if (agentProven) {
      status = 'failed'
      reason = 'expectation-mismatch'
    } else {
      status = 'blocked'
      reason = 'inconclusive'
    }
  } else if (evidencePass) {
    if (consolePolicy === 'fail' && consoleErrors.length) {
      status = 'failed'
      reason = 'console-error'
    } else {
      status = 'passed'
      reason = agentStatus === 'complete' ? 'goal-and-evidence' : 'evidence-overrides-fastbrowse'
    }
  } else if (agentProven) {
    status = 'failed'
    reason = 'expectation-mismatch'
  } else if (transient.length) {
    status = 'blocked'
    reason = 'network'
  } else if (pages.length || finalUrl) {
    status = 'blocked'
    reason = 'inconclusive'
  }

  const label = goal.label || 'le comportement attendu'
  let actual = ''
  if (status === 'passed') {
    if (!probe.available) {
      actual = `Vérifié par fastbrowse : ${label}. Statut fastbrowse : ${agentStatus || 'inconnu'}. URL finale : ${finalUrl || 'inconnue'}.`
    } else {
      let observedLabel = 'des produits avec prix'
      if (articleCount != null) {
        observedLabel = `${articleCount} article${articleCount > 1 ? 's' : ''} dans le panier`
      } else if (productCount != null) {
        observedLabel = `${productCount} produit${productCount > 1 ? 's' : ''} trouvé${productCount > 1 ? 's' : ''}`
      } else if (goal.probeText || /product\//i.test(goal.probeUrl ?? '')) {
        observedLabel = 'la fiche produit affiche le nom, le prix et le stock'
      }
      actual = `Attendu observé : ${label}. ${observedLabel}, contenu affiché en ${formatMs(probeContentMs)} (seuil ${formatMs(maxContentMs)})`
      if (probeReloadContentMs != null) actual += `, puis ${formatMs(probeReloadContentMs)} après rechargement`
      actual += '.'
      if (consoleErrors.length) actual += ` Avertissement console : « ${shortConsole(consoleErrors[0])} ».`
    }
  } else if (reason === 'slow-content') {
    const which = slowContent ? 'au premier affichage' : 'après rechargement'
    const ms = slowContent ? probeContentMs : probeReloadContentMs
    const seen = productCount != null
      ? `${productCount} produit${productCount > 1 ? 's' : ''} visible${productCount > 1 ? 's' : ''}`
      : 'le contenu attendu visible'
    actual = `Le contenu attendu (${label}) est bien là (${seen}), mais il s'affiche ${which} après ${formatMs(ms)}, au-delà du seuil de ${formatMs(maxContentMs)}. C'est trop lent pour un client. Extrait : « ${excerpt} ».`
  } else if (reason === 'negative-evidence') {
    const count = productCount != null ? `${productCount} produit${productCount > 1 ? 's' : ''}` : 'aucun produit'
    const instability = agentProductCount != null && agentProductCount !== productCount
      ? ` L'affichage est instable : ${count} maintenant, ${agentProductCount} produit${agentProductCount > 1 ? 's' : ''} pendant le parcours fastbrowse.`
      : ''
    actual = `La page affiche ${count} / « ${negative} » au lieu de ${label}.${instability} Extrait : « ${excerpt} ».`
  } else if (reason === 'content-missing') {
    actual = `Le contenu attendu (${label}) n'apparaît pas après ${formatMs(maxWaitMs)}. Textes absents : ${missingTexts.map((pattern) => `« ${pattern} »`).join(', ')}. La page affiche : « ${excerpt} ».`
  } else if (reason === 'reload-missing') {
    actual = `Le contenu était visible au premier chargement, mais il n'apparaît plus après rechargement (${formatMs(probeReloadContentMs ?? maxWaitMs)}). Extrait : « ${excerpt} ».`
  } else if (reason === 'console-error') {
    actual = `Le contenu attendu (${label}) est affiché en ${formatMs(probeContentMs)}, mais la console contient une erreur : « ${shortConsole(consoleErrors[0])} ».`
  } else if (reason === 'network') {
    const detail = probe.navError || `HTTP ${probeHttpStatus ?? 'inconnu'}`
    const agentDetail = agentError ? ` fastbrowse : ${agentError}.` : ''
    actual = `Impossible de charger ${goal.probeUrl || finalUrl} : ${detail}.${agentDetail}${transient.length ? ` Fournisseur : ${transient[0].title}.` : ''}`
  } else if (reason === 'expectation-mismatch') {
    actual = `Le parcours fastbrowse n'a pas produit le résultat attendu (${label}). URL finale : ${finalUrl || 'aucune'}. Textes absents du parcours : ${finalMissingTexts.map((pattern) => `« ${pattern} »`).join(', ') || 'aucun'}. Extrait : « ${excerpt} ».`
  } else if (reason === 'timeout') {
    actual = `fastbrowse n'a pas terminé dans le délai imparti. Dernière URL : ${finalUrl || 'aucune'}.`
  } else if (reason === 'no-json' || reason.startsWith('invalid-json')) {
    actual = `fastbrowse n'a pas renvoyé de résultat exploitable${run.parseError ? ` : ${cleanText(run.parseError, 240)}` : ''}.`
  } else {
    const agentDetail = agentError ? ` Détail fastbrowse : ${agentError}.` : ''
    actual = `Preuve insuffisante : ${label}. Statut fastbrowse : ${agentStatus || 'inconnu'}. URL finale : ${finalUrl || 'aucune'}.${agentDetail} Extrait : « ${excerpt} ».`
  }

  return {
    status,
    reason,
    urlOk,
    textOk,
    textChecks,
    probeTextChecks,
    probeTextOk,
    probeReloadOk,
    negativeChecks,
    hasNegativeEvidence: Boolean(negative),
    consoleErrors,
    seriousFindings: [],
    transient,
    findings,
    pages,
    finalUrl,
    probe,
    productCount,
    agentProductCount,
    articleCount,
    contentMs: probeContentMs,
    reloadContentMs: probeReloadContentMs,
    maxContentMs,
    slowContent,
    slowReload,
    missingTexts,
    excerpt,
    actual,
    note: actual,
  }
}

function compactEvidence(c, goal, run, verdict) {
  const json = run.json
  const lines = json?.cost?.lines ?? []
  const cost = lines.reduce((sum, line) => sum + (typeof line?.dollars === 'number' ? line.dollars : 0), 0)
  const unknownCost = lines.some((line) => line?.dollars == null)
  return {
    engine: 'fastbrowse',
    fastbrowse_status: json?.status ?? null,
    fastbrowse_error: json?.error ?? null,
    fastbrowse_answer: json?.answer ? cleanText(json.answer, 1200) : null,
    fastbrowse_cost_dollars: cost || null,
    fastbrowse_cost_unknown: unknownCost,
    actions: Array.isArray(json?.steps) ? json.steps.length : 0,
    elapsed_ms: run.durationMs,
    final_url: verdict.finalUrl || null,
    expectations: goal.expect ?? {},
    url_ok: verdict.urlOk,
    text_ok: verdict.textOk,
    text_checks: verdict.textChecks,
    probe_text_checks: verdict.probeTextChecks,
    negative_checks: verdict.negativeChecks,
    actual: verdict.actual,
    probe: verdict.probe ? {
      available: verdict.probe.available,
      url: verdict.probe.url ?? null,
      http_status: verdict.probe.httpStatus ?? null,
      content_ms: verdict.probe.contentMs ?? null,
      reload_content_ms: verdict.probe.reloadContentMs ?? null,
      duration_ms: verdict.probe.durationMs ?? null,
      threshold_ms: verdict.maxContentMs,
      matched: verdict.probe.matched ?? null,
      reload_matched: verdict.probe.reloadMatched ?? null,
      negative: verdict.probe.negative ?? null,
      product_count: verdict.productCount,
      fastbrowse_product_count: verdict.agentProductCount,
      article_count: verdict.articleCount,
      excerpt: verdict.excerpt,
      console_errors: verdict.probe.consoleErrors ?? [],
      nav_error: verdict.probe.navError ?? null,
      webmcp: verdict.probe.webmcp ?? null,
    } : null,
    network_findings: verdict.transient?.map((finding) => ({ title: finding.title, detail: finding.detail })) ?? [],
    cached: run.cached === true,
    findings: verdict.findings.slice(0, 8).map((finding) => ({
      source: finding.source,
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
    })),
    pages: verdict.pages.slice(-3).map((page) => ({
      url: page.url,
      title: page.title,
      excerpt: String(page.excerpt ?? '').slice(0, 2500),
    })),
    fastbrowse_steps: (json?.steps ?? []).slice(-12).map((step) => ({
      operation: step.operation,
      target: step.target ?? null,
      outcome: step.outcome ?? null,
      decided_by: step.decided_by ?? null,
      note: step.note ?? null,
      url: step.url ?? null,
    })),
    evidence_quotes: (json?.evidence ?? []).slice(-8).map((evidence) => ({
      url: evidence.url,
      quote: String(evidence.quote ?? '').slice(0, 1000),
    })),
    stderr: run.stderr ? run.stderr.slice(-1200) : undefined,
  }
}

function stepResults(c, status, verdict, run, goal) {
  const steps = c.steps.length ? c.steps : [{ n: 1, action: c.title, expected: 'Comportement attendu observé' }]
  const evidence = compactEvidence(c, goal, run, verdict)
  const probe = verdict.probe?.available ? verdict.probe : null
  const openActual = probe
    ? `Page ouverte : ${probe.url || 'URL inconnue'}${probe.httpStatus != null ? ` (HTTP ${probe.httpStatus})` : ''}. ${verdict.contentMs != null ? `Contenu affiché en ${formatMs(verdict.contentMs)}.` : 'Le contenu attendu ne s’est pas affiché dans le délai.'}`
    : `Page ouverte par fastbrowse. URL finale : ${verdict.finalUrl || 'inconnue'}.`
  const reloadActual = verdict.reloadContentMs != null
    ? `Après rechargement, le contenu attendu est toujours affiché en ${formatMs(verdict.reloadContentMs)} (seuil ${formatMs(verdict.maxContentMs)}).`
    : 'Contrôle final effectué sur la page déjà chargée.'

  return steps.map((step, i) => {
    let stepStatus = 'passed'
    let actual = ''
    if (status === 'passed') {
      actual = i === 0 ? openActual : i === 1 ? verdict.actual : reloadActual
    } else if (status === 'failed') {
      if (i === 0) {
        stepStatus = 'passed'
        actual = openActual
      } else if (i === 1) {
        stepStatus = 'failed'
        actual = verdict.actual
      } else {
        stepStatus = 'skipped'
        actual = 'Non exécutée : l’échec a été constaté avant cette étape.'
      }
    } else if (status === 'blocked') {
      if (i === 0) {
        stepStatus = 'blocked'
        actual = verdict.actual
      } else {
        stepStatus = 'skipped'
        actual = 'Non exécutée : le parcours n’a pas pu aboutir.'
      }
    } else {
      stepStatus = 'skipped'
      actual = 'Non exécutée.'
    }
    return {
      n: step.n,
      code: `${c.code}-${step.n}`,
      action: step.action,
      expected: step.expected,
      actual: String(actual).slice(0, 2000),
      status: stepStatus,
      evidence,
    }
  })
}

const startedAt = new Date()
const results = []
const probeBrowser = await openProbe(FASTBROWSE_DIR)
if (probeBrowser.available) {
  console.log(`\n🔎 Sonde de page prête (${probeBrowser.executablePath})`)
} else {
  console.log(`\n⚠ Sonde de page indisponible : ${probeBrowser.reason}`)
}

try {
  for (const [index, c] of cases.entries()) {
    const goal = goalFor(c)
    console.log(`\n▶ ${c.code} — ${c.title}`)
    if (index > 0 && CASE_DELAY_MS > 0 && !REUSE_CACHE) {
      console.log(`  … pause ${Math.round(CASE_DELAY_MS / 1000)} s entre les cas`)
      await sleep(CASE_DELAY_MS)
    }
    const run = await runFastbrowse(c)
    const verdict = await verify(c, goal, run, probeBrowser)
    console.log(`  ${verdict.status.toUpperCase()} (${verdict.reason}) · ${run.durationMs} ms · ${run.json?.steps?.length ?? '?'} étapes`)
    console.log(`  ${verdict.actual.slice(0, 700)}`)
    const webmcpTools = verdict.probe?.webmcp?.tools ?? []
    if (webmcpTools.length) {
      console.log(`  WebMCP : ${webmcpTools.length} outil(s) — ${webmcpTools.map((tool) => tool.name).join(', ')}`)
    }
    results.push({
      code: c.code,
      title: c.title,
      category: c.category,
      suite: c.suite,
      description: c.description,
      discovered: c.discovered,
      severity: c.severity,
      status: verdict.status,
      note: verdict.note.slice(0, 4000),
      duration_ms: run.durationMs,
      steps: stepResults(c, verdict.status, verdict, run, goal),
    })
  }
} finally {
  if (probeBrowser.available) await probeBrowser.browser.close().catch(() => {})
}

const counts = { passed: 0, failed: 0, blocked: 0, skipped: 0 }
for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1
const payload = {
  run_id: env('QA_RUN_ID') || null,
  model: env('FASTBROWSE_REPORT_MODEL', 'opencode/deepseek-v4.1-flash+jev-1.13'),
  executor: 'fastbrowse',
  started_at: startedAt.toISOString(),
  finished_at: new Date().toISOString(),
  duration_ms: results.reduce((sum, result) => sum + result.duration_ms, 0),
  cases: results,
  summary: counts,
}

writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2))
console.log(`\nRésultat écrit dans ${OUTPUT_FILE}`)
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
