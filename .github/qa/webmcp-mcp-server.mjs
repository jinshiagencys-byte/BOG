#!/usr/bin/env node
/**
 * Serveur MCP « WebMCP » — la surface d'exécution d'Antigravity.
 *
 * Antigravity (`agy`) décide : il ouvre une page, lit les outils que la page
 * expose via `document.modelContext`, choisit celui à appeler et interprète le
 * résultat. Ce serveur ne décide rien : il transporte un Chrome réel jusqu'à la
 * page et exécute l'outil WebMCP demandé, y compris sa confirmation visible.
 *
 * Il parle le protocole MCP en `stdio` : messages JSON-RPC 2.0, un par ligne
 * sur stdin/stdout. La journalisation part sur stderr pour ne jamais polluer le
 * flux du protocole.
 *
 * Playwright n'est ici qu'un client CDP : ce n'est ni un scénario, ni un
 * décideur. Deux modes de connexion :
 *   • `WEBMCP_CDP_URL` fourni  -> on se branche sur le Chrome déjà lancé
 *     (celui du sous-agent navigateur d'Antigravity) ;
 *   • sinon                    -> on lance notre propre Chrome headless.
 *
 * Le flag `--enable-features=WebMCPTesting` est indispensable : sans lui,
 * `document.modelContext` n'existe pas dans Chrome stable.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const require = createRequire(import.meta.url)

const env = (name, fallback = null) => {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}
const truthy = new Set(['1', 'true', 'yes', 'on'])

const PROBE_DIR = env('WEBMCP_PROBE_DIR', join(process.cwd(), 'node_modules'))
const CDP_URL = env('WEBMCP_CDP_URL')
const STORAGE_STATE = env('WEBMCP_STORAGE_STATE')
const VIDEO_DIR = env('WEBMCP_VIDEO_DIR')
const HEADLESS = !['0', 'false', 'no', 'off'].includes(String(env('WEBMCP_HEADLESS', 'true')).toLowerCase())
const CONFIRM_DEFAULT = ['accept', 'true', '1'].includes(String(env('WEBMCP_CONFIRM', 'dismiss')).toLowerCase())
const VIDEO_TAIL_MS = Number(env('WEBMCP_VIDEO_TAIL_MS', '700')) || 0

const WEBMCP_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--enable-features=WebMCPTesting',
]

function log(...args) {
  process.stderr.write(`${new Date().toISOString()} [webmcp-mcp] ${args.join(' ')}\n`)
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error ?? 'erreur inconnue')
}

function safeName(value) {
  return String(value || 'page').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80)
}

function loadPlaywright() {
  for (const name of ['playwright-core', 'patchright', 'playwright']) {
    try {
      const mod = require(join(PROBE_DIR, 'node_modules', name))
      if (mod?.chromium) return mod
    } catch {
      // continue
    }
  }
  try {
    const mod = require('playwright-core')
    if (mod?.chromium) return mod
  } catch {
    // continue
  }
  return null
}

function chromePath() {
  const candidates = [
    env('CHROME_PATH'),
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

// ---------------------------------------------------------------------------
// État navigateur

let playwright = null
let browser = null
let context = null
let page = null
let contextOwned = false
const consoleErrors = []
const httpErrors = []
let dialog = null

async function ensureContext() {
  if (context) return context
  playwright = playwright || loadPlaywright()
  if (!playwright) throw new Error('playwright-core introuvable (définis WEBMCP_PROBE_DIR ou NODE_PATH)')

  if (CDP_URL) {
    browser = await playwright.chromium.connectOverCDP(CDP_URL)
    contextOwned = false
    context = browser.contexts()[0] ?? (await browser.newContext())
    log(`branché sur le Chrome existant ${CDP_URL}`)
  } else {
    const executablePath = chromePath()
    if (!executablePath) throw new Error('Google Chrome introuvable')
    browser = await playwright.chromium.launch({ executablePath, headless: HEADLESS, args: WEBMCP_ARGS })
    contextOwned = true
    context = await browser.newContext({
      locale: 'fr-FR',
      viewport: { width: 1280, height: 720 },
      ...(VIDEO_DIR ? { recordVideo: { dir: join(VIDEO_DIR, '.tmp'), size: { width: 1280, height: 720 } } } : {}),
      ...(STORAGE_STATE && existsSync(STORAGE_STATE) ? { storageState: STORAGE_STATE } : {}),
    })
    log(`Chrome lancé (${executablePath}, headless=${HEADLESS})`)
  }
  return context
}

async function activePage() {
  await ensureContext()
  if (!page || page.isClosed()) {
    page = await context.newPage()
    wirePage(page)
  }
  return page
}

function wirePage(target) {
  target.on('console', (message) => {
    if (message.type() === 'error' && consoleErrors.length < 25) consoleErrors.push(message.text().slice(0, 300))
  })
  target.on('pageerror', (error) => {
    if (consoleErrors.length < 25) consoleErrors.push(`Uncaught: ${messageOf(error)}`.slice(0, 300))
  })
  target.on('response', (response) => {
    if (response.status() < 400 || httpErrors.length >= 30) return
    httpErrors.push({ status: response.status(), url: response.url().slice(0, 300) })
  })
  // Les mutations WebMCP passent par `window.confirm`. La politique par défaut
  // refuse la mutation : l'agent doit l'accepter explicitement, comme un
  // utilisateur prudent.
  target.on('dialog', async (current) => {
    dialog = { type: current.type(), message: current.message(), accepted: pendingConfirm }
    try {
      if (pendingConfirm) await current.accept()
      else await current.dismiss()
    } catch {
      // La page a pu se fermer entre-temps.
    }
  })
}

let pendingConfirm = CONFIRM_DEFAULT

async function saveVideo(current) {
  if (!VIDEO_DIR || !current) return null
  try {
    const video = current.video()
    if (!video) return null
    await current.close()
    const target = join(VIDEO_DIR, `${safeName(current.__webmcpName || `page-${Date.now()}`)}.webm`)
    mkdirSync(VIDEO_DIR, { recursive: true })
    await video.saveAs(target)
    return target
  } catch (error) {
    log(`vidéo non enregistrée : ${messageOf(error)}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Outils WebMCP de la page

async function listWebMcpTools(target, { waitFor = null, timeoutMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let rows = []
  while (true) {
    rows = await target
      .evaluate(async () => {
        if (!document.modelContext || typeof document.modelContext.getTools !== 'function') return null
        try {
          const tools = await document.modelContext.getTools()
          return tools.map((tool) => ({
            name: tool.name,
            description: tool.description ?? '',
            inputSchema: tool.inputSchema ?? null,
            readOnly: tool.annotations?.readOnlyHint ?? null,
            consequential: tool.annotations?.consequentialHint ?? null,
          }))
        } catch (error) {
          return { __error: String(error?.message ?? error) }
        }
      })
      .catch(() => null)

    if (rows === null) return { available: false, tools: [], reason: 'document.modelContext absent (flag WebMCPTesting ?)' }
    if (!Array.isArray(rows)) return { available: true, tools: [], reason: rows.__error ?? 'getTools a échoué' }
    if (!waitFor || rows.some((tool) => tool.name === waitFor) || Date.now() >= deadline) {
      return { available: true, tools: rows }
    }
    await target.waitForTimeout(250)
  }
}

async function scrollThrough(target, { steps = 8, pauseMs = 250 } = {}) {
  const total = Math.max(1, Math.min(40, Number(steps)))
  const pause = Math.max(0, Math.min(2000, Number(pauseMs)))
  let previous = -1
  for (let index = 0; index < total; index += 1) {
    const height = await target.evaluate(() => document.documentElement.scrollHeight).catch(() => 0)
    const viewport = await target.evaluate(() => window.innerHeight).catch(() => 720)
    await target
      .evaluate(({ y }) => window.scrollTo(0, y), { y: Math.min(height, (index + 1) * viewport * 0.85) })
      .catch(() => {})
    if (pause) await target.waitForTimeout(pause)
    if (height === previous && index > 1) break
    previous = height
  }
  await target.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
}

// Un texte présent dans le DOM mais jamais amené à l'écran ne compte pas :
// on le fait défiler jusqu'à la fenêtre et on vérifie sa boîte.
async function checkVisibleTexts(target, patterns) {
  const viewport = target.viewportSize() ?? { width: 1280, height: 720 }
  const checks = []
  for (const pattern of patterns) {
    const locator = target.getByText(new RegExp(pattern, 'i'))
    let found = 0
    try {
      found = await locator.count()
    } catch {
      found = 0
    }
    let visible = false
    let inViewport = false
    const limit = Math.min(found, 8)
    for (let index = 0; index < limit; index += 1) {
      const node = locator.nth(index)
      const box = await node.boundingBox().catch(() => null)
      if (!box) continue
      await node.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
      const nodeVisible = await node.isVisible().catch(() => false)
      if (!nodeVisible) continue
      const after = await node.boundingBox().catch(() => null)
      if (
        after &&
        after.y + Math.min(after.height, 4) >= 0 &&
        after.y <= viewport.height &&
        after.x < viewport.width &&
        after.x + Math.min(after.width, 4) >= 0
      ) {
        visible = true
        inViewport = true
        break
      }
      visible = true
    }
    checks.push({ pattern, found, visible, inViewport })
  }
  return checks
}

// ---------------------------------------------------------------------------
// Définitions des outils MCP

const TOOLS = [
  {
    name: 'webmcp_open',
    description:
      'Ouvre une URL dans le Chrome QA et renvoie l’URL finale, le titre et la liste des outils WebMCP que la page expose. À appeler avant tout autre outil.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL absolue à ouvrir.' } },
      required: ['url'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'webmcp_list_tools',
    description:
      'Liste les outils WebMCP de la page courante : nom, description, paramètres attendus, lecture seule ou conséquentiel.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'webmcp_call_tool',
    description:
      'Exécute un outil WebMCP exposé par la page courante. Pour une mutation conséquentielle, mettre confirm=true accepte la confirmation visible ; sinon elle est refusée (cancelled=true).',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Nom exact de l’outil WebMCP.' },
        arguments: { type: 'object', description: 'Arguments de l’outil.', additionalProperties: true },
        confirm: { type: 'boolean', description: 'Accepter une confirmation visible (défaut : refuser).' },
      },
      required: ['tool'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'webmcp_read_page',
    description:
      'Fait défiler la page courante et renvoie le texte réellement affiché, l’URL, le titre, les erreurs console, et pour chaque motif fourni s’il est visible à l’écran.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL optionnelle à ouvrir avant lecture.' },
        expected: {
          type: 'array',
          items: { type: 'string' },
          description: 'Motifs (expressions régulières insensibles à la casse) à vérifier comme visibles.',
        },
      },
    },
    annotations: { readOnlyHint: true },
  },
]

function textResult(payload, isError = false) {
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  }
}

async function callTool(name, args = {}) {
  switch (name) {
    case 'webmcp_open': {
      const url = String(args.url || '').trim()
      if (!url) throw new Error('url requise')
      if (page && VIDEO_DIR) await saveVideo(page)
      else if (page && !page.isClosed()) await page.close().catch(() => {})
      page = null
      dialog = null
      consoleErrors.length = 0
      httpErrors.length = 0
      const target = await activePage()
      target.__webmcpName = safeName(url)
      await target.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await target.waitForTimeout(1500)
      const listed = await listWebMcpTools(target)
      return textResult({
        url: target.url(),
        title: await target.title().catch(() => ''),
        webmcpAvailable: listed.available,
        tools: listed.tools,
        ...(listed.reason ? { reason: listed.reason } : {}),
      })
    }
    case 'webmcp_list_tools': {
      const target = await activePage()
      const listed = await listWebMcpTools(target)
      return textResult({ url: target.url(), ...listed })
    }
    case 'webmcp_call_tool': {
      const tool = String(args.tool || '').trim()
      if (!tool) throw new Error('tool requis')
      const input = args.arguments && typeof args.arguments === 'object' ? args.arguments : {}
      const previous = pendingConfirm
      pendingConfirm = typeof args.confirm === 'boolean' ? args.confirm : CONFIRM_DEFAULT
      const target = await activePage()
      const started = performance.now()
      try {
        const listed = await listWebMcpTools(target, { waitFor: tool })
        if (!listed.tools.some((row) => row.name === tool)) {
          return textResult(
            { ok: false, error: `Outil WebMCP introuvable : ${tool}`, available: listed.tools.map((row) => row.name) },
            true,
          )
        }
        const execution = await target.evaluate(
          async ({ name, value }) => {
            const rows = await document.modelContext.getTools()
            const found = rows.find((row) => row.name === name)
            if (!found) return { ok: false, error: 'tool-not-found' }
            try {
              return { ok: true, result: await document.modelContext.executeTool(found, JSON.stringify(value)) }
            } catch (first) {
              try {
                return { ok: true, result: await document.modelContext.executeTool(found, value) }
              } catch (second) {
                const describe = (error) => String(error?.message ?? error)
                return { ok: false, error: describe(second), firstError: describe(first) }
              }
            }
          },
          { name: tool, value: input },
        )
        return textResult({
          ok: execution.ok === true,
          tool,
          arguments: input,
          result: execution.result ?? null,
          dialog,
          url: target.url(),
          durationMs: Math.round(performance.now() - started),
          ...(execution.ok ? {} : { error: execution.error, firstError: execution.firstError }),
        }, execution.ok !== true)
      } finally {
        pendingConfirm = previous
      }
    }
    case 'webmcp_read_page': {
      const target = await activePage()
      if (args.url) {
        await target.goto(String(args.url), { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
        await target.waitForTimeout(1200)
      }
      await scrollThrough(target)
      const text = await target.locator('body').innerText({ timeout: 5000 }).catch(() => '')
      const expected = Array.isArray(args.expected) ? args.expected.map((item) => String(item)) : []
      const checks = expected.length ? await checkVisibleTexts(target, expected) : []
      return textResult({
        url: target.url(),
        title: await target.title().catch(() => ''),
        text: String(text).replace(/\s+\n/g, '\n').slice(0, 8000),
        visible: checks,
        consoleErrors: [...new Set(consoleErrors)].slice(0, 12),
        httpErrors: httpErrors.slice(0, 12),
      })
    }
    default:
      throw new Error(`Outil inconnu : ${name}`)
  }
}

// ---------------------------------------------------------------------------
// Boucle JSON-RPC sur stdio

const PROTOCOL_FALLBACK = '2025-06-18'
let buffer = ''

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handle(message) {
  const { id, method, params } = message
  if (method === 'initialize') {
    sendResult(id, {
      protocolVersion: params?.protocolVersion ?? PROTOCOL_FALLBACK,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'webmcp', version: '1.0.0' },
    })
    return
  }
  if (method === 'notifications/initialized' || method === 'initialized') return
  if (method === 'notifications/cancelled') return
  if (method === 'ping') {
    sendResult(id, {})
    return
  }
  if (method === 'tools/list') {
    sendResult(id, { tools: TOOLS })
    return
  }
  if (method === 'tools/call') {
    const name = params?.name
    try {
      sendResult(id, await callTool(name, params?.arguments ?? {}))
    } catch (error) {
      log(`outil ${name} en échec : ${messageOf(error)}`)
      sendResult(id, textResult({ ok: false, error: messageOf(error) }, true))
    }
    return
  }
  if (id !== undefined) sendError(id, -32601, `Méthode inconnue : ${method}`)
}

async function shutdown(code = 0) {
  try {
    if (page && VIDEO_DIR) await saveVideo(page)
    if (contextOwned && context) await context.close().catch(() => {})
    if (contextOwned && browser) await browser.close().catch(() => {})
  } catch {
    // Rien à faire : on quitte.
  }
  process.exit(code)
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let boundary
  while ((boundary = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, boundary).trim()
    buffer = buffer.slice(boundary + 1)
    if (!line) continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      log(`ligne ignorée (JSON invalide) : ${line.slice(0, 200)}`)
      continue
    }
    Promise.resolve(handle(message)).catch((error) => {
      log(`erreur de traitement : ${messageOf(error)}`)
      if (message?.id !== undefined) sendError(message.id, -32603, messageOf(error))
    })
  }
})
process.stdin.on('end', () => shutdown(0))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0))
}

log('serveur prêt (stdio)')
