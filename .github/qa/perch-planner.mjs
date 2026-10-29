#!/usr/bin/env node
/**
 * Plan QA produit par le CLI Perch.
 *
 * Perch n'expose pas d'API publique : son modèle frontier n'est joignable que
 * par ses surfaces officielles, dont `perch run "<tâche>" --json`, une commande
 * non interactive qui rend un objet JSON sur stdout. On l'appelle avec
 * exactement les mêmes messages que le relais `qa-plan`
 * (`buildPlanMessages`), puis on applique le même filtrage (`normalizePlan`) :
 * le plan n'est jamais repris tel quel.
 *
 * Le CLI est isolé dans un dossier vide, sans outils locaux, pour qu'il ne
 * lise rien du dépôt. Session requise : `PERCH_CLI_AUTH_DIR` doit contenir un
 * `cli-auth-session.json` valide (voir docs/qa-webmcp.md).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPlanMessages, extractJson, normalizePlan } from './case-planner.mjs'

const env = (name, fallback = '') => {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

/** Binaire du CLI : un chemin explicite, sinon `perch` résolu dans le PATH. */
export function perchBinary() {
  const bin = env('PERCH_BIN', 'perch')
  if (bin.includes('/')) return existsSync(bin) ? bin : null
  const found = spawnSync('which', [bin], { encoding: 'utf8' })
  return found.status === 0 && found.stdout.trim() ? found.stdout.trim() : null
}

/** Le CLI est utilisable seulement si le binaire et une session sont là. */
export function perchAvailable() {
  if (env('WEBMCP_PERCH', 'auto') === 'off') return false
  if (!perchBinary()) return false
  // Sans session, `perch run` sortirait une erreur de routage après une
  // dizaine de secondes : autant ne pas enregistrer le fournisseur du tout.
  const authDir = env('PERCH_CLI_AUTH_DIR') || join(homedir(), '.perch')
  return existsSync(join(authDir, 'cli-auth-session.json'))
}

function runPerch({ bin, prompt, timeoutMs }) {
  const sandbox = mkdtempSync(join(tmpdir(), 'perch-plan-'))
  const mode = env('PERCH_MODE', 'ask')
  const model = env('PERCH_MODEL')
  const effort = env('PERCH_EFFORT')
  const args = ['run', prompt, '--json', '--cwd', sandbox, '--no-local-tools', '--mode', mode]
  if (model) args.push('--model', model)
  if (effort) args.push('--effort', effort)
  return new Promise((resolveRun) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      rmSync(sandbox, { recursive: true, force: true })
      resolveRun({ ok: false, error: error.message, stdout, stderr })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      rmSync(sandbox, { recursive: true, force: true })
      resolveRun({
        ok: code === 0 && !timedOut,
        code,
        error: timedOut ? `perch run dépassé (${timeoutMs} ms)` : null,
        stdout,
        stderr,
      })
    })
  })
}

/**
 * Demande au CLI Perch le schéma des cas, puis le filtre comme le relais.
 *
 * @returns {Promise<{ plan: Record<string, object>, model: string }>}
 */
export async function planWithPerch({ profile, cases, timeoutMs = 240000 }) {
  const bin = perchBinary()
  if (!bin) throw new Error('CLI Perch introuvable (PERCH_BIN ou PATH)')
  if (!Array.isArray(cases) || !cases.length) throw new Error('aucun cas à planifier')

  const messages = buildPlanMessages({ profile, cases })
  const system = messages.find((message) => message.role === 'system')?.content ?? ''
  const user = messages.find((message) => message.role === 'user')?.content ?? ''
  const prompt = [
    system,
    '',
    'Données observées et cas à planifier (JSON) :',
    user,
    '',
    'Réponds uniquement par le JSON demandé, sans commentaire ni texte autour.',
  ].join('\n')

  const result = await runPerch({ bin, prompt, timeoutMs })
  if (!result.ok) {
    const tail = `${result.stderr}\n${result.stdout}`.trim().split('\n').slice(-3).join(' · ')
    throw new Error(`${result.error ?? `code ${result.code}`}${tail ? ` — ${tail}` : ''}`)
  }

  let payload = null
  try {
    payload = JSON.parse(result.stdout)
  } catch {
    throw new Error(`stdout non JSON : ${result.stdout.slice(0, 160)}`)
  }
  const assistantText = String(payload?.assistantText ?? '')
  const parsed = extractJson(assistantText)
  if (!parsed) {
    throw new Error(
      `réponse sans JSON : ${(assistantText || payload?.error || 'vide').slice(0, 160)}`,
    )
  }

  const plan = Object.fromEntries(
    Object.entries(normalizePlan(parsed, profile)).filter(
      ([, entry]) => entry.motif || entry.checks.length || entry.mustSee.length,
    ),
  )
  if (!Object.keys(plan).length) throw new Error('plan vide après filtrage')
  return { plan, model: `perch:${env('PERCH_MODEL', 'auto')}` }
}
