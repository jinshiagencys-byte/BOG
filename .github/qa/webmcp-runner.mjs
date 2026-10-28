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
const RUN_TOKEN = env('RUN_TOKEN')
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

// Deux familles de cas :
//   • webmcp    — la page expose l’outil, on l’exécute ;
//   • playwright — on rejoue une suite d’actions déterministes sur un site réel.
function specFor(c) {
  const configured = goals[c.code]
  if (!configured) return null

  const webmcp = configured.webmcp
  if (webmcp?.tool) {
    return {
      kind: 'webmcp',
      tool: webmcp.tool,
      args: webmcp.args ?? {},
      confirm: webmcp.confirm === true,
      waitMs: webmcp.waitMs,
      timeoutMs: webmcp.timeoutMs,
      url: expandEnv(webmcp.url || configured.webmcpUrl || configured.url || TARGET_URL),
      storageState: expandEnv(webmcp.storageState ?? configured.storageState ?? '') || null,
      expect: webmcp.expect ?? {},
      label: configured.label || `l’outil ${webmcp.tool}`,
    }
  }

  const scenario = configured.playwright
  if (scenario?.steps?.length) {
    return {
      kind: 'playwright',
      steps: scenario.steps,
      waitMs: scenario.waitMs,
      timeoutMs: scenario.timeoutMs,
      url: expandEnv(scenario.url || configured.url || TARGET_URL),
      storageState: expandEnv(scenario.storageState ?? configured.storageState ?? '') || null,
      expect: scenario.expect ?? configured.expect ?? {},
      label: configured.label || `le scénario ${c.code}`,
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
  const networkLike = /net::|econn|err_|failed to load|timeout/i.test(error)
  const actions = execution.steps ?? []
  const httpErrors = Array.isArray(execution.httpErrors) ? execution.httpErrors : []
  const rateLimited = httpErrors.filter((item) => item.status === 429)

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
  }

  if (status === 'passed') {
    actual += textChecks.length
      ? ` Vérifié : ${textChecks.map((check) => `« ${check.pattern} »`).join(', ')}.`
      : ' Aucune assertion de texte demandée.'
  }

  return {
    status,
    reason,
    urlOk,
    textOk: textChecks.every((check) => check.ok),
    textChecks,
    negativeChecks,
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
