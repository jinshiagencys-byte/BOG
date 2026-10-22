#!/usr/bin/env node
/**
 * Suit l'état d'un run GitHub Actions déclenché par l'agent QA.
 *
 * Usage (depuis la racine du dépôt) :
 *   node supabase/scripts/github-run-status.mjs <run_id>
 *   node supabase/scripts/github-run-status.mjs <run_id> --watch
 *
 * Le script lit les identifiants de la GitHub App dans supabase/.env.local.
 * Il ne les affiche jamais.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const ENV_PATH = path.join(ROOT, 'supabase', '.env.local')

function readEnv(file) {
  const out = {}
  const text = fs.readFileSync(file, 'utf8')
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index < 0) continue
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function appJwt(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
  )
  const data = `${header}.${payload}`
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(data), privateKey)
    .toString('base64url')
  return `${data}.${signature}`
}

async function github(pathname, token, options = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`GitHub ${pathname} → HTTP ${response.status}: ${text.slice(0, 300)}`)
  }
  return text ? JSON.parse(text) : null
}

/** Convertit l'état GitHub vers les statuts stockés dans test_runs. */
export function mapGithubStatus(run) {
  if (run.status !== 'completed') return 'running'
  switch (run.conclusion) {
    case 'success':
      return 'passed'
    case 'cancelled':
    case 'stale':
      return 'cancelled'
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
    case 'action_required':
    case 'skipped':
    case 'neutral':
      return 'failed'
    default:
      return 'error'
  }
}

async function main() {
  const runId = process.argv[2]
  const watch = process.argv.includes('--watch')
  if (!runId) {
    console.error('Usage : node supabase/scripts/github-run-status.mjs <run_id> [--watch]')
    process.exit(2)
  }

  const env = readEnv(ENV_PATH)
  const appId = env.GITHUB_APP_ID
  const installationId = env.GITHUB_INSTALLATION_ID
  const repo = env.GITHUB_REPO_FULL_NAME
  const keyPath = env.GITHUB_APP_PRIVATE_KEY_PATH

  if (!appId || !installationId || !repo || !keyPath) {
    console.error('Configuration incomplète dans supabase/.env.local')
    process.exit(2)
  }

  const privateKey = fs.readFileSync(keyPath, 'utf8')
  const jwt = appJwt(appId, privateKey)
  const installation = await github(
    `/app/installations/${installationId}/access_tokens`,
    jwt,
    { method: 'POST' },
  )
  const token = installation?.token
  if (!token) throw new Error('Jeton installation GitHub absent')

  const [owner, name] = repo.split('/')
  const base = `/repos/${owner}/${name}/actions/runs/${runId}`

  let run
  do {
    run = await github(base, token)
    console.log(
      new Date().toISOString(),
      'run:',
      run.status,
      run.conclusion ?? '',
      '→ app:',
      mapGithubStatus(run),
    )
    if (run.status === 'completed') break
    if (!watch) break
    await new Promise((resolve) => setTimeout(resolve, 15000))
  } while (true)

  const jobs = await github(`${base}/jobs?per_page=100`, token)
  for (const job of jobs.jobs ?? []) {
    console.log(`JOB ${job.name} → ${job.status} ${job.conclusion ?? ''}`)
    for (const step of job.steps ?? []) {
      console.log(
        `  ${step.number}. ${step.name} → ${step.status} ${step.conclusion ?? ''}`,
      )
    }
  }

  if (run.status === 'completed' && run.conclusion !== 'success') {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
