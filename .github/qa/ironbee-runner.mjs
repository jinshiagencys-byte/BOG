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
    expect: { url: '', text: [], console: 'warn' },
  }
}

function cachePath(code) {
  return join(CACHE_DIR, `${code}.json`)
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function transientFindings(json) {
  return (json?.analysis?.findings ?? []).filter((f) =>
    /ECONNRESET|ERR_CONNECTION|429|too many requests|failed to load resource|timeout/i.test(
      `${f.title ?? ''} ${f.detail ?? ''}`,
    ),
  )
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
    const transient = run.timedOut || !run.json || transientFindings(run.json).length > 0
    if (!transient) break
    const delay = RETRY_DELAY_MS * attempt
    console.log(`  ↻ tentative ${attempt + 1}/${RETRIES + 1} dans ${Math.round(delay / 1000)} s (site transitoirement indisponible)`)
    await sleep(delay)
    run = await runIronBeeOnce(c, goal)
  }
  return run
}

function textOf(json) {
  return (json?.journey?.pages ?? []).map((p) => p.excerpt ?? '').join('\n')
}

function verify(c, goal, run) {
  const json = run.json
  const findings = Array.isArray(json?.analysis?.findings) ? json.analysis.findings : []
  const pages = Array.isArray(json?.journey?.pages) ? json.journey.pages : []
  const text = textOf(json)
  const finalUrl = json?.finalUrl ?? pages.at(-1)?.url ?? ''
  const urlOk = !goal.expect?.url || new RegExp(goal.expect.url, 'i').test(finalUrl) || pages.some((p) => new RegExp(goal.expect.url, 'i').test(p.url ?? ''))
  const textChecks = (goal.expect?.text ?? []).map((pattern) => ({
    pattern,
    ok: new RegExp(pattern, 'i').test(text),
  }))
  const textOk = textChecks.every((x) => x.ok)
  const negativeChecks = (goal.expect?.failIfText ?? []).map((pattern) => ({
    pattern,
    matched: new RegExp(pattern, 'i').test(text),
  }))
  const hasNegativeEvidence = negativeChecks.some((x) => x.matched)
  const consoleErrors = findings.filter((f) => f.source === 'console' && /error|uncaught|NG\d{4}/i.test(`${f.title ?? ''} ${f.detail ?? ''}`))
  const seriousFindings = findings.filter((f) => ['major', 'critical'].includes(f.severity))
  const transient = transientFindings(json)
  const consolePolicy = goal.expect?.console ?? 'warn'

  let status = 'blocked'
  let reason = 'no-evidence'
  if (run.timedOut) {
    status = 'blocked'
    reason = 'timeout'
  } else if (!json) {
    status = 'blocked'
    reason = run.parseError ? `invalid-json: ${run.parseError}` : 'no-json'
  } else if (urlOk && hasNegativeEvidence) {
    // The browser reached the expected page and the page explicitly contradicts
    // the expectation (for example \"Aucun produit trouvé\"). A network warning
    // or a blocked agent verdict must not hide a real product failure.
    status = 'failed'
    reason = 'negative-evidence'
  } else if (urlOk && textOk) {
    if (consolePolicy === 'fail' && consoleErrors.length) {
      status = 'failed'
      reason = 'console-error'
    } else {
      status = 'passed'
      reason = json.status === 'done' ? 'goal-and-evidence' : 'evidence-overrides-ironbee'
    }
  } else if (json.status === 'done') {
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

  const noteParts = []
  if (json?.analysis?.summary) noteParts.push(json.analysis.summary)
  if (json && json.status !== 'done') noteParts.push(`IronBee: ${json.status ?? 'unknown'}${json.reason ? `/${json.reason}` : ''}`)
  if (!urlOk) noteParts.push(`URL attendue non atteinte (${finalUrl || 'aucune'})`)
  for (const check of textChecks) {
    if (!check.ok) noteParts.push(`Texte attendu absent: ${check.pattern}`)
  }
  for (const check of negativeChecks) {
    if (check.matched) noteParts.push(`Preuve négative observée: ${check.pattern}`)
  }
  if (transient.length) noteParts.push(`Réseau: ${transient.map((f) => f.title).join(' | ').slice(0, 500)}`)
  if (consoleErrors.length) {
    noteParts.push(`Console${consolePolicy === 'fail' ? '' : ' (avertissement)'}: ${consoleErrors.map((f) => f.title).join(' | ').slice(0, 500)}`)
  }
  if (run.parseError) noteParts.push(`Sortie IronBee illisible: ${run.parseError}`)

  return {
    status,
    reason,
    urlOk,
    textOk,
    textChecks,
    negativeChecks,
    hasNegativeEvidence,
    consoleErrors,
    seriousFindings,
    transient,
    findings,
    pages,
    finalUrl,
    note: noteParts.join(' · ') || (status === 'passed' ? 'Preuves conformes' : 'Preuve insuffisante'),
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
    negative_checks: verdict.negativeChecks,
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
  return steps.map((s, i) => {
    let stepStatus = 'passed'
    if (status === 'passed') stepStatus = 'passed'
    else if (status === 'failed') stepStatus = i === steps.length - 1 ? 'failed' : 'passed'
    else if (status === 'blocked') stepStatus = i === 0 ? 'blocked' : 'skipped'
    else stepStatus = 'skipped'
    const actual = status === 'passed'
      ? (verdict.note || 'Vérifié dans le navigateur')
      : status === 'failed'
        ? (i === steps.length - 1 ? verdict.note : 'Étape exécutée avant l’échec')
        : status === 'blocked'
          ? (i === 0 ? verdict.note : 'Non exécutée')
          : 'Non exécutée'
    return {
      n: s.n,
      code: `${c.code}-${s.n}`,
      action: s.action,
      expected: s.expected,
      actual: String(actual).slice(0, 1500),
      status: stepStatus,
      evidence,
    }
  })
}

const startedAt = new Date()
const results = []
for (const [index, c] of cases.entries()) {
  const goal = goals[c.code] ?? defaultGoal(c)
  console.log(`\n▶ ${c.code} — ${c.title}`)
  if (index > 0 && CASE_DELAY_MS > 0 && !REUSE_CACHE) {
    console.log(`  … pause ${Math.round(CASE_DELAY_MS / 1000)} s entre les cas`)
    await sleep(CASE_DELAY_MS)
  }
  const run = await runIronBee(c)
  const verdict = verify(c, goal, run)
  console.log(`  ${verdict.status.toUpperCase()} (${verdict.reason}) · ${run.durationMs} ms · ${run.json?.actions ?? '?'} actions`)
  console.log(`  ${verdict.note.slice(0, 500)}`)
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
