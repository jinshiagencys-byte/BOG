#!/usr/bin/env node
/**
 * Test de fumée fastbrowse : vérifie que la chaîne Jev (System One) + LLM
 * fonctionne de bout en bout avec les clés du dépôt, puis qu'un vrai parcours
 * navigateur aboutit et renvoie des preuves.
 *
 * Contrairement à `fastbrowse-runner.mjs` (qui exécute un plan de cas QA
 * fourni par l'application), ce script n'a besoin d'aucun run Supabase : il
 * lance deux objectifs fixes sur une URL publique et affiche le JSON fastbrowse.
 *
 * Fournisseur (variable `SMOKE_PROVIDER`) :
 *   - `tokenharbor` : LLM via `https://tokenharbor.ai/v1` (clé `TOKENHARBOR_API_KEY`),
 *                     Jev via OpenCode (clé `OPENCODE_API_KEY`) — la combinaison
 *                     recommandée : TokenHarbor fournit le LLM, Jev reste chez OpenCode ;
 *   - `opencode`    : Jev via `https://opencode.ai/inference/systemone`, LLM via
 *                     `https://opencode.ai/inference/openai/v1` (clé `OPENCODE_API_KEY`) ;
 *   - `openrouter`  : Jev et LLM via OpenRouter (clé `OPENROUTER_API_KEY`) ;
 *   - `auto` (défaut) : tokenharbor si sa clé est présente (avec OpenCode pour
 *                     Jev), sinon opencode, sinon openrouter.
 *
 * Sortie : `qa-smoke.json` (réponses brutes + résumé). Code de sortie 1 seulement
 * si aucun objectif n'a produit de JSON exploitable — un échec de contenu est un
 * résultat QA, pas une panne de la chaîne.
 */

import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(process.env.QA_ROOT || join(HERE, '..', '..'))
const FASTBROWSE_DIR = resolve(process.env.FASTBROWSE_DIR || join(ROOT, '..', 'fastbrowse'))
const LOCAL_CLI = join(FASTBROWSE_DIR, '.venv', 'bin', 'fastbrowse')
const FASTBROWSE_CLI = process.env.FASTBROWSE_CLI || (existsSync(LOCAL_CLI) ? LOCAL_CLI : 'fastbrowse')
const TARGET_URL = process.env.SMOKE_URL || 'https://www.iana.org/'
const OUT = resolve(process.env.QA_OUTPUT || join(ROOT, 'qa-smoke.json'))
const CASE_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || '180000')
const MAX_STEPS = Number(process.env.SMOKE_MAX_STEPS || '12')
const MAX_DOLLARS = Number(process.env.SMOKE_MAX_DOLLARS || '0.10')

const PROVIDER = (() => {
  const requested = (process.env.SMOKE_PROVIDER || 'auto').toLowerCase()
  if (requested !== 'auto') return requested
  if (process.env.TOKENHARBOR_API_KEY && process.env.OPENCODE_API_KEY) return 'tokenharbor'
  if (process.env.OPENCODE_API_KEY) return 'opencode'
  if (process.env.OPENROUTER_API_KEY) return 'openrouter'
  return 'none'
})()

function buildEnv() {
  const env = { ...process.env }
  // Aucun repli silencieux : un seul fournisseur, choisi explicitement.
  delete env.OPENROUTER_API_KEY
  delete env.AI_GATEWAY_API_KEY
  delete env.BROWSER_USE_API_KEY

  if (PROVIDER === 'tokenharbor') {
    // LLM chez TokenHarbor (proxy neutre OpenAI-compatible).
    env.TOKENHARBOR_API_KEY = process.env.TOKENHARBOR_API_KEY || ''
    env.FASTBROWSE_LLM_API_KEY = process.env.TOKENHARBOR_API_KEY || ''
    env.FASTBROWSE_LLM_BASE_URL = process.env.SMOKE_LLM_BASE_URL || 'https://tokenharbor.ai/v1'
    env.FASTBROWSE_LLM_MODEL = process.env.SMOKE_LLM_MODEL || 'deepseek-v4.1-flash:free'
    // Jev reste chez OpenCode (System One).
    const key = process.env.OPENCODE_API_KEY || ''
    env.OPENCODE_API_KEY = key
    env.TYPESAFE_API_KEY = key
    env.FASTBROWSE_JEV_SOURCE = 'typesafe'
    env.FASTBROWSE_JEV_BASE_URL = 'https://opencode.ai/inference/systemone'
    env.FASTBROWSE_JEV_MODEL = process.env.SMOKE_JEV_MODEL || 'jev-1.13-free'
  } else if (PROVIDER === 'opencode') {
    const key = process.env.OPENCODE_API_KEY || ''
    env.OPENCODE_API_KEY = key
    env.TYPESAFE_API_KEY = key
    env.FASTBROWSE_LLM_API_KEY = key
    env.FASTBROWSE_LLM_BASE_URL = 'https://opencode.ai/inference/openai/v1'
    env.FASTBROWSE_LLM_MODEL = process.env.SMOKE_LLM_MODEL || 'deepseek-v4.1-flash'
    env.FASTBROWSE_JEV_SOURCE = 'typesafe'
    env.FASTBROWSE_JEV_BASE_URL = 'https://opencode.ai/inference/systemone'
    env.FASTBROWSE_JEV_MODEL = process.env.SMOKE_JEV_MODEL || 'jev-1.13'
  } else if (PROVIDER === 'openrouter') {
    env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
    env.FASTBROWSE_JEV_SOURCE = 'openrouter'
    env.FASTBROWSE_JEV_MODEL = process.env.SMOKE_JEV_MODEL || 'jev-1.13'
    if (process.env.SMOKE_LLM_MODEL) env.FASTBROWSE_LLM_MODEL = process.env.SMOKE_LLM_MODEL
  }
  return env
}

const env = buildEnv()
// Un modèle « free » (TokenHarbor `:free`, OpenCode `-free`, OpenRouter `:free`)
// ne rapporte aucun coût : le plafond en dollars est alors inapplicable.
const FREE_MODEL = /free/i.test(`${env.FASTBROWSE_LLM_MODEL || ''}`)

const GOALS = [
  {
    name: 'paragraph',
    goal: `Va sur cette page et donne le texte exact du premier paragraphe visible sous le titre.`,
    check: (json) => /global coordination of the DNS root/i.test(JSON.stringify(json)),
  },
  {
    name: 'navigate',
    goal: `Clique sur le lien « Domains » du menu principal et donne l'URL finale obtenue.`,
    check: (json) => /iana\.org\/domains/i.test(JSON.stringify(json)),
  },
]

// --- Sondes indépendantes : Jev seul, puis LLM seul. -------------------------
// Elles distinguent une panne de la chaîne d'un simple manque de crédits, et
// n'appellent pas de navigateur.

async function probeJev() {
  const base = env.FASTBROWSE_JEV_BASE_URL || 'https://openrouter.ai/api/v1'
  const url = `${base.replace(/\/$/, '')}/v1/systemone`
  const key = env.TYPESAFE_API_KEY || env.OPENROUTER_API_KEY || ''
  const model = env.FASTBROWSE_JEV_MODEL || 'jev-1.13'
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        state: 'Le ciel est bleu et dégagé.',
        questions: { is_blue: { type: 'noul', instructions: 'Is the sky described as blue?' } },
      }),
    })
    return { url, model, status: res.status, ok: res.ok, body: (await res.text()).slice(0, 400) }
  } catch (error) {
    return { url, model, status: 0, ok: false, body: String(error.message) }
  }
}

async function probeLlm() {
  const base = env.FASTBROWSE_LLM_BASE_URL || 'https://openrouter.ai/api/v1'
  const url = `${base.replace(/\/$/, '')}/chat/completions`
  const key = env.FASTBROWSE_LLM_API_KEY || env.OPENROUTER_API_KEY || ''
  const model = env.FASTBROWSE_LLM_MODEL || 'google/gemini-3.8-flash'
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'dis juste: bonjour' }], max_tokens: 8 }),
    })
    return { url, model, status: res.status, ok: res.ok, body: (await res.text()).slice(0, 400) }
  } catch (error) {
    return { url, model, status: 0, ok: false, body: String(error.message) }
  }
}

function runOnce(goal) {
  const args = [
    goal.goal,
    '--start', TARGET_URL,
    '--json',
    '--local',
    '--max-steps', String(MAX_STEPS),
  ]
  // Un modèle gratuit rapporte un coût de 0 ; fastbrowse refuse alors d'appliquer
  // un plafond en dollars (« a call reported no cost »). On omet donc
  // `--max-dollars` pour un modèle `*-free`, et quand la limite est à 0.
  if (!FREE_MODEL && MAX_DOLLARS > 0) args.push('--max-dollars', String(MAX_DOLLARS))
  return new Promise((resolvePromise) => {
    const started = performance.now()
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(FASTBROWSE_CLI, args, {
      cwd: FASTBROWSE_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, CASE_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const finish = (code) => {
      clearTimeout(timer)
      let json = null
      let parseError = null
      try {
        json = JSON.parse(stdout.trim())
      } catch (error) {
        parseError = error.message
      }
      resolvePromise({
        name: goal.name,
        goal: goal.goal,
        exitCode: code,
        timedOut,
        durationMs: Math.round(performance.now() - started),
        json,
        parseError,
        stderr: stderr.slice(-4000),
        checkOk: json ? Boolean(goal.check(json)) : false,
      })
    }
    child.on('error', (error) => { stderr += `\n${error.message}`; finish(127) })
    child.on('close', (code) => finish(code))
  })
}

console.log(`fastbrowse smoke — cible ${TARGET_URL}`)
console.log(`fournisseur : ${PROVIDER}`)
console.log(
  `clés : TOKENHARBOR_API_KEY=${process.env.TOKENHARBOR_API_KEY ? 'oui' : 'non'}, ` +
  `OPENCODE_API_KEY=${process.env.OPENCODE_API_KEY ? 'oui' : 'non'}, ` +
  `OPENROUTER_API_KEY=${process.env.OPENROUTER_API_KEY ? 'oui' : 'non'}`,
)

if (PROVIDER === 'none') {
  console.error('Aucune clé (TOKENHARBOR_API_KEY, OPENCODE_API_KEY ou OPENROUTER_API_KEY). Rien à tester.')
  process.exit(2)
}

console.log('\n— sonde Jev (System One) —')
const jev = await probeJev()
console.log(`  HTTP ${jev.status} · ${jev.model} · ${jev.url}`)
console.log(`  ${jev.ok ? 'OK' : 'ÉCHEC'} : ${jev.body.replace(/\s+/g, ' ').slice(0, 220)}`)

console.log('\n— sonde LLM (chat completions) —')
const llm = await probeLlm()
console.log(`  HTTP ${llm.status} · ${llm.model} · ${llm.url}`)
console.log(`  ${llm.ok ? 'OK' : 'ÉCHEC'} : ${llm.body.replace(/\s+/g, ' ').slice(0, 220)}`)

const results = []
for (const goal of GOALS) {
  if (!llm.ok) {
    console.log(`\n▶ ${goal.name} — ignoré (LLM indisponible : HTTP ${llm.status})`)
    results.push({
      name: goal.name,
      goal: goal.goal,
      exitCode: null,
      timedOut: false,
      durationMs: 0,
      json: null,
      parseError: null,
      stderr: `LLM indisponible (HTTP ${llm.status})`,
      checkOk: false,
      skipped: true,
    })
    continue
  }
  console.log(`\n▶ ${goal.name} — ${goal.goal}`)
  const run = await runOnce(goal)
  results.push(run)
  const status = run.json ? (run.checkOk ? 'OK' : 'JSON sans le texte attendu') : 'PAS DE JSON'
  console.log(`  ${status} · exit=${run.exitCode} · ${run.durationMs} ms`)
  if (run.json) {
    console.log(`  statut fastbrowse : ${run.json.status ?? '?'} · URL finale : ${run.json.final_url ?? '?'}`)
    if (run.json.answer) console.log(`  réponse : ${String(run.json.answer).slice(0, 300)}`)
  } else if (run.parseError) {
    console.log(`  parse : ${run.parseError}`)
  }
  if (run.stderr) console.log(`  stderr : ${run.stderr.split('\n').slice(-3).join(' | ')}`)
}

const payable = results.filter((run) => run.json).length
const summary = {
  provider: PROVIDER,
  target: TARGET_URL,
  date: new Date().toISOString(),
  probes: { jev, llm },
  goals: results.length,
  exploitable: payable,
  ok: results.filter((run) => run.checkOk).length,
  results: results.map((run) => ({
    name: run.name,
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
    parseError: run.parseError,
    checkOk: run.checkOk,
    fastbrowse_status: run.json?.status ?? null,
    final_url: run.json?.final_url ?? null,
    answer: run.json?.answer ?? null,
    error: run.json?.error ?? null,
    steps: Array.isArray(run.json?.steps) ? run.json.steps.length : 0,
    stderr: run.stderr || null,
  })),
}
writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`)
console.log(`\nRésumé écrit dans ${OUT}`)
console.log(JSON.stringify({
  provider: summary.provider,
  jev: jev.status,
  llm: llm.status,
  exploitable: summary.exploitable,
  ok: summary.ok,
}))

// Échec dur uniquement si la chaîne n'a produit aucun résultat exploitable.
process.exit(payable === 0 ? 1 : 0)
