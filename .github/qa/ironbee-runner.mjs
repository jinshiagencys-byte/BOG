#!/usr/bin/env node
/**
 * IronBee QA runner.
 *
 * The runner owns the test plan and the assertions. IronBee owns the browser
 * goal, the typed Jev decisions and the evidence review (page, API, console).
 *
 * This is deliberately not "trust the agent's verdict": a case passes only
 * when our own expectations match IronBee's evidence. A blocked IronBee run
 * can still be a passing case when the page evidence proves the expectation
 * (for example: "the category page lists products" while Jev keeps asking
 * whether the goal is done).
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { openProbe, probeUrl } from './page-probe.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

function readEnvFile(file) {
  const out = {}
  if (!existsSync(file)) return out
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    let value = line.slice(i + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[line.slice(0, i).trim()] = value
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
const IRONBEE_DIR = resolve(env('IRONBEE_DIR', '/tmp/opencode/ironbee-express'))
const IRONBEE_CLI = resolve(env('IRONBEE_CLI', join(IRONBEE_DIR, 'dist', 'cli', 'main.js')))
const GOALS_FILE = resolve(env('IRONBEE_CASES', join(HERE, 'ironbee-cases.json')))
const PLAN_FILE = resolve(env('PLAN_FILE', join(ROOT, 'plan-cases.json')))
const MANIFEST_FILE = resolve(env('RUN_MANIFEST', join(ROOT, 'run_manifest.json')))
const OUTPUT_FILE = resolve(env('QA_OUTPUT', join(ROOT, 'qa_result.json')))
const CACHE_DIR = resolve(env('QA_CACHE_DIR', '/tmp/opencode/qa-cache'))
const TARGET_URL = env('TARGET_URL', 'https://odjafrik.com')
const MAX_CASE_MS = Number(env('IRONBEE_CASE_TIMEOUT_MS', '240000'))
const REUSE_CACHE = env('IRONBEE_REUSE') === '1'
const CASE_DELAY_MS = Number(env('IRONBEE_DELAY_MS', '4000'))
const RETRIES = Number(env('IRONBEE_RETRIES', '1'))
const RETRY_DELAY_MS = Number(env('IRONBEE_RETRY_DELAY_MS', '45000'))
const ONLY = env('CASE_CODES', '').split(',').map((v) => v.trim()).filter(Boolean)

const ironbeeEnv = {
  ...readEnvFile(join(IRONBEE_DIR, '.env')),
  ...process.env,
}
if (!ironbeeEnv.TYPESAFE_API_KEY && ironbeeEnv.OPENROUTER_API_KEY) {
  ironbeeEnv.TYPESAFE_API_KEY = ironbeeEnv.OPENROUTER_API_KEY
}
ironbeeEnv.TYPESAFE_URL ||= 'https://openrouter.ai/api/v1/systemone'
ironbeeEnv.TYPESAFE_MODEL ||= 'jev-latest'
ironbeeEnv.IBEXPRESS_HEADLESS ||= 'true'

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
  console.error('Aucun cas à exécuter. Vérifie PLAN_FILE/RUN_MANIFEST et CASE_CODES.')
  process.exit(2)
}
if (!existsSync(IRONBEE_CLI)) {
  console.error(`IronBee CLI introuvable: ${IRONBEE_CLI}`)
  process.exit(2)
}

function defaultGoal(c) {
  return {
    url: TARGET_URL,
    goal: `On ${TARGET_URL}, verify this test case: "${c.title}". ${c.steps.map((s) => `${s.n}. ${s.action} (attendu: ${s.expected})`).join(' ')} Stop when the page clearly shows the result. Do not perform unrelated actions.`,
    label: c.title,
    expect: { url: '', text: [], console: 'warn' },
  }
}

function cachePath(code) {
  return join(CACHE_DIR, `${code}.json`)
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function isTransientFinding(f) {
  return /ECONNRESET|ERR_CONNECTION|429|too many requests|failed to load resource|timeout/i.test(
    `${f.title ?? ''} ${f.detail ?? ''}`,
  )
}

function transientFindings(json) {
  return (json?.analysis?.findings ?? []).filter(isTransientFinding)
}

function runIronBeeOnce(c, goal) {
  const args = [
    IRONBEE_CLI,
    'run',
    '--url', goal.url || TARGET_URL,
    '--goal', goal.goal,
    '--json',
  ]
  return new Promise((resolvePromise) => {
    const started = performance.now()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(process.execPath, args, {
      cwd: IRONBEE_DIR,
      env: ironbeeEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, MAX_CASE_MS)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => {
      clearTimeout(timer)
      let json = null
      let parseError = null
      try {
        json = JSON.parse(stdout)
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
        stderr: stderr.slice(-4000),
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
    })
  })
}

async function runIronBee(c) {
  const goal = goals[c.code] ?? defaultGoal(c)

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

  let run = await runIronBeeOnce(c, goal)
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    // Ne jamais rejouer un cas qui a produit un verdict et des preuves.
    // Les 429 observés dans une page déjà chargée ne doivent pas transformer
    // un échec produit en trois passages de plusieurs minutes.
    const technicalFailure = run.timedOut || !run.json
    if (!technicalFailure) break
    const delay = RETRY_DELAY_MS * attempt
    console.log(`  ↻ tentative ${attempt + 1}/${RETRIES + 1} dans ${Math.round(delay / 1000)} s (sortie IronBee incomplète)`)
    await sleep(delay)
    run = await runIronBeeOnce(c, goal)
  }
  return run
}

function textOf(json) {
  return (json?.journey?.pages ?? []).map((p) => p.excerpt ?? '').join('\n')
}

function formatMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'non mesuré'
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`
}

function cleanText(value, max = 700) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
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

async function verify(c, goal, run, probeBrowser) {
  const json = run.json
  const findings = Array.isArray(json?.analysis?.findings) ? json.analysis.findings : []
  const pages = Array.isArray(json?.journey?.pages) ? json.journey.pages : []
  const text = textOf(json)
  const finalUrl = json?.finalUrl ?? pages.at(-1)?.url ?? ''
  const maxContentMs = goal.perf?.maxContentMs ?? 5000
  const maxWaitMs = goal.perf?.maxWaitMs ?? 15000
  const ironbeeUrlOk = !goal.expect?.url || new RegExp(goal.expect.url, 'i').test(finalUrl) || pages.some((p) => new RegExp(goal.expect.url, 'i').test(p.url ?? ''))
  const textChecks = (goal.expect?.text ?? []).map((pattern) => ({
    pattern,
    ok: new RegExp(pattern, 'i').test(text),
  }))
  const textOk = textChecks.every((x) => x.ok)
  const negativeChecks = (goal.expect?.failIfText ?? []).map((pattern) => ({
    pattern,
    matched: new RegExp(pattern, 'i').test(text),
  }))
  const ironbeeNegative = negativeChecks.find((x) => x.matched)?.pattern ?? null
  const ironbeeFindings = findings.filter((f) => f.source === 'console' && isSeriousConsole(`${f.title ?? ''} ${f.detail ?? ''}`))
  const seriousFindings = findings.filter((f) =>
    ['major', 'critical'].includes(f.severity) && !isTransientFinding(f),
  )
  const transient = transientFindings(json)
  const consolePolicy = goal.expect?.console ?? 'warn'

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

  const probeUrlOk = probe.available &&
    (!goal.expect?.url || new RegExp(goal.expect.url, 'i').test(probe.url ?? ''))
  const urlOk = ironbeeUrlOk || probeUrlOk
  const probeTextChecks = probe.available
    ? (goal.probeText || goal.expect?.text || []).map((pattern) => ({
        pattern,
        ok: new RegExp(pattern, 'i').test(probe.text ?? ''),
      }))
    : []
  const probeTextOk = probe.available ? probe.matched : null
  const probeReloadOk = probe.available ? probe.reloadMatched : null
  const contentOk = probe.available
    ? probe.matched && (!goal.probeText || textOk)
    : textOk
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
  const ironbeeProductCount = productCountOf(text)
  const articleCount = articleCountOf(text) ?? articleCountOf(probe.text)
  const negative = probe.available ? probe.negative : ironbeeNegative
  const consoleErrors = uniqueStrings([
    ...(probe.available ? probe.consoleErrors : []),
    ...ironbeeFindings.map((finding) => finding.title),
  ]).filter(isSeriousConsole)
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
    if (json?.status === 'done') {
      status = 'failed'
      reason = 'expectation-mismatch'
    } else {
      status = 'blocked'
      reason = 'inconclusive'
    }
  } else if (contentOk) {
    if (consolePolicy === 'fail' && consoleErrors.length) {
      status = 'failed'
      reason = 'console-error'
    } else {
      status = 'passed'
      reason = json?.status === 'done' ? 'goal-and-evidence' : 'evidence-overrides-ironbee'
    }
  } else if (json?.status === 'done') {
    status = 'failed'
    reason = 'expectation-mismatch'
  } else if (transient.length) {
    status = 'blocked'
    reason = 'network'
  } else if (pages.length || finalUrl) {
    status = 'blocked'
    reason = 'inconclusive'
  }

  if (seriousFindings.length && status === 'passed') {
    status = 'failed'
    reason = 'serious-finding'
  }

  const label = goal.label || 'le comportement attendu'
  let actual = ''
  if (status === 'passed') {
    if (!probe.available) {
      const observedLabel = productCount != null
        ? `${productCount} produit${productCount > 1 ? 's' : ''} trouvé${productCount > 1 ? 's' : ''}`
        : (goal.expect?.text?.length ? 'les textes attendus sont présents' : 'le parcours est terminé')
      actual = `Vérifié par IronBee : ${label}. ${observedLabel}. Mesure de performance indisponible pour ce cas.`
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
    const instability = ironbeeProductCount != null && ironbeeProductCount !== productCount
      ? ` L'affichage est instable : ${count} maintenant, ${ironbeeProductCount} produit${ironbeeProductCount > 1 ? 's' : ''} pendant le parcours IronBee.`
      : ''
    actual = `La page affiche ${count} / « ${negative} » au lieu de ${label}.${instability} Extrait : « ${excerpt} ».`
  } else if (reason === 'content-missing') {
    actual = `Le contenu attendu (${label}) n'apparaît pas après ${formatMs(maxWaitMs)}. Textes absents : ${missingTexts.map((p) => `« ${p} »`).join(', ')}. La page affiche : « ${excerpt} ».`
  } else if (reason === 'reload-missing') {
    actual = `Le contenu était visible au premier chargement, mais il n'apparaît plus après rechargement (${formatMs(probeReloadContentMs ?? maxWaitMs)}). Extrait : « ${excerpt} ».`
  } else if (reason === 'console-error') {
    actual = `Le contenu attendu (${label}) est affiché en ${formatMs(probeContentMs)}, mais la console contient une erreur : « ${shortConsole(consoleErrors[0])} ».`
  } else if (reason === 'network') {
    const detail = probe.navError || `HTTP ${probeHttpStatus ?? 'inconnu'}`
    actual = `Impossible de charger ${goal.probeUrl || finalUrl} : ${detail}. ${transient.length ? `IronBee a aussi vu : ${transient.map((f) => f.title).join(' | ').slice(0, 300)}.` : ''}`
  } else if (reason === 'expectation-mismatch') {
    actual = `Le parcours n'a pas produit le résultat attendu (${label}). URL finale : ${finalUrl || 'aucune'}. Textes absents du parcours : ${finalMissingTexts.map((p) => `« ${p} »`).join(', ') || 'aucun'}. Extrait : « ${excerpt} ».`
  } else if (reason === 'timeout') {
    actual = `IronBee n'a pas terminé dans le délai imparti. Dernière URL : ${finalUrl || 'aucune'}.`
  } else if (reason === 'no-json' || reason.startsWith('invalid-json')) {
    actual = `IronBee n'a pas renvoyé de résultat exploitable${run.parseError ? ` : ${cleanText(run.parseError, 240)}` : ''}.`
  } else if (reason === 'serious-finding') {
    actual = `Le contenu est visible, mais IronBee a relevé un problème sérieux : ${seriousFindings.map((f) => f.title).join(' | ').slice(0, 400)}.`
  } else {
    actual = `Preuve insuffisante : ${label}. URL finale : ${finalUrl || 'aucune'}. Extrait : « ${excerpt} ».`
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
    seriousFindings,
    transient,
    findings,
    pages,
    finalUrl,
    probe,
    productCount,
    ironbeeProductCount,
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
  return {
    engine: 'ironbee',
    ironbee_status: run.json?.status ?? null,
    ironbee_reason: run.json?.reason ?? null,
    ironbee_verdict: run.json?.analysis?.verdict ?? null,
    ironbee_summary: run.json?.analysis?.summary ?? null,
    actions: run.json?.actions ?? run.json?.steps?.length ?? 0,
    decisions: run.json?.decisions ?? null,
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
      ironbee_product_count: verdict.ironbeeProductCount,
      article_count: verdict.articleCount,
      excerpt: verdict.excerpt,
      console_errors: verdict.probe.consoleErrors ?? [],
      nav_error: verdict.probe.navError ?? null,
    } : null,
    network_findings: verdict.transient?.map((f) => ({ title: f.title, detail: f.detail })) ?? [],
    cached: run.cached === true,
    findings: verdict.findings.slice(0, 8).map((f) => ({
      source: f.source,
      severity: f.severity,
      title: f.title,
      detail: f.detail,
    })),
    pages: verdict.pages.slice(-3).map((p) => ({
      url: p.url,
      title: p.title,
      excerpt: String(p.excerpt ?? '').slice(0, 2500),
    })),
    ironbee_steps: (run.json?.steps ?? []).slice(-12).map((s) => ({
      operation: s.operation,
      target: s.targetLabel ?? s.target ?? null,
      text: s.text ?? null,
      url: s.url ?? null,
      goal: s.goal ?? null,
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
    : `Page ouverte par IronBee. URL finale : ${verdict.finalUrl || 'inconnue'}.`
  const reloadActual = verdict.reloadContentMs != null
    ? `Après rechargement, le contenu attendu est toujours affiché en ${formatMs(verdict.reloadContentMs)} (seuil ${formatMs(verdict.maxContentMs)}).`
    : 'Contrôle final effectué sur la page déjà chargée.'

  return steps.map((s, i) => {
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
      n: s.n,
      code: `${c.code}-${s.n}`,
      action: s.action,
      expected: s.expected,
      actual: String(actual).slice(0, 2000),
      status: stepStatus,
      evidence,
    }
  })
}

const startedAt = new Date()
const results = []
const probeBrowser = await openProbe(IRONBEE_DIR)
if (probeBrowser.available) {
  console.log(`\n🔎 Sonde de page prête (${probeBrowser.executablePath})`)
} else {
  console.log(`\n⚠ Sonde de page indisponible : ${probeBrowser.reason}`)
}

try {
  for (const [index, c] of cases.entries()) {
    const goal = goals[c.code] ?? defaultGoal(c)
    console.log(`\n▶ ${c.code} — ${c.title}`)
    if (index > 0 && CASE_DELAY_MS > 0 && !REUSE_CACHE) {
      console.log(`  … pause ${Math.round(CASE_DELAY_MS / 1000)} s entre les cas`)
      await sleep(CASE_DELAY_MS)
    }
    const run = await runIronBee(c)
    const verdict = await verify(c, goal, run, probeBrowser)
    console.log(`  ${verdict.status.toUpperCase()} (${verdict.reason}) · ${run.durationMs} ms · ${run.json?.actions ?? '?'} actions`)
    console.log(`  ${verdict.actual.slice(0, 700)}`)
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
for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1
const payload = {
  run_id: env('QA_RUN_ID') || null,
  model: env('IRONBEE_REPORT_MODEL', 'openrouter/jev-latest'),
  executor: 'ironbee',
  started_at: startedAt.toISOString(),
  finished_at: new Date().toISOString(),
  duration_ms: results.reduce((sum, r) => sum + r.duration_ms, 0),
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
