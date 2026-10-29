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
 * Il n'a aucune dépendance : il pilote Chrome via `.github/qa/cdp-client.mjs`
 * (WebSocket natif de Node), pas via Playwright. Deux modes de connexion :
 *   • `WEBMCP_CDP_URL` fourni  -> on se branche sur le Chrome déjà lancé
 *     (celui du sous-agent navigateur d'Antigravity) ;
 *   • sinon                    -> on lance notre propre Chrome headless.
 *
 * Le flag `--enable-features=WebMCPTesting` est indispensable : sans lui,
 * `document.modelContext` n'existe pas dans Chrome stable.
 */

import { existsSync, readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { connectBrowser, launchBrowser } from './cdp-client.mjs'

const env = (name, fallback = null) => {
  const value = process.env[name]
  return value === undefined || value === '' ? fallback : value
}

const CDP_URL = env('WEBMCP_CDP_URL')
const STORAGE_STATE = env('WEBMCP_STORAGE_STATE')
const HEADLESS = !['0', 'false', 'no', 'off'].includes(String(env('WEBMCP_HEADLESS', 'true')).toLowerCase())
const CONFIRM_DEFAULT = ['accept', 'true', '1'].includes(String(env('WEBMCP_CONFIRM', 'dismiss')).toLowerCase())

// Fenêtre fixée : la taille par défaut de Chrome headless (~780x493) est sous le
// point de rupture desktop de nombreux sites, ce qui fait mesurer 0x0 les
// éléments réservés au desktop et les déclare « non visibles ». On aligne donc le
// viewport du serveur MCP sur celui de la sonde (`page-probe.mjs`, 1440x900) pour
// que les deux surfaces QA rendent le même verdict. Surchargeable par WEBMCP_VIEWPORT.
const VIEWPORT = (() => {
  const match = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i.exec(String(env('WEBMCP_VIEWPORT', '1440x900')).trim())
  if (!match) return { width: 1440, height: 900 }
  return { width: Number(match[1]), height: Number(match[2]) }
})()

function log(...args) {
  process.stderr.write(`${new Date().toISOString()} [webmcp-mcp] ${args.join(' ')}\n`)
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error ?? 'erreur inconnue')
}

// ---------------------------------------------------------------------------
// État navigateur

let browser = null
let page = null

async function ensureBrowser() {
  if (browser && !browser.closed) return browser
  browser = CDP_URL ? await connectBrowser(CDP_URL) : await launchBrowser({ headless: HEADLESS })
  log(CDP_URL ? `branché sur le Chrome existant ${CDP_URL}` : `Chrome lancé (${browser.executablePath ?? 'chrome'}, headless=${HEADLESS})`)
  return browser
}

async function activePage() {
  const current = await ensureBrowser()
  if (page) return page
  page = await current.newPage()
  await page.connection
    .send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false }, page.sessionId)
    .catch(() => {})
  await page.connection.send('Emulation.setLocaleOverride', { locale: 'fr-FR' }, page.sessionId).catch(() => {})
  if (STORAGE_STATE && existsSync(STORAGE_STATE)) {
    try {
      await page.applyStorageState(JSON.parse(readFileSync(STORAGE_STATE, 'utf8')))
      log(`état de session appliqué depuis ${STORAGE_STATE}`)
    } catch (error) {
      log(`état de session ignoré : ${messageOf(error)}`)
    }
  }
  return page
}

// ---------------------------------------------------------------------------
// Outils WebMCP de la page

async function listWebMcpTools(target, { waitFor = null, timeoutMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    let rows = null
    try {
      rows = await target.callFunction(async () => {
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
    } catch {
      rows = null
    }
    if (rows === null) {
      return { available: false, apiPresent: false, tools: [], reason: 'document.modelContext absent (flag WebMCPTesting ?)' }
    }
    if (!Array.isArray(rows)) {
      return { available: false, apiPresent: true, tools: [], reason: rows.__error ?? 'getTools a échoué' }
    }
    if (!waitFor || rows.some((tool) => tool.name === waitFor) || Date.now() >= deadline) {
      // Chrome expose `document.modelContext` (avec `getTools()`) sur toute origine
      // sécurisée réelle, même quand la page n'enregistre aucun outil. `available`
      // ne doit donc pas dire « l'API existe » mais « il y a des outils à appeler »,
      // sinon tout site paraît pilotable et Antigravity tente des appels voués à
      // l'échec. La présence brute de l'API est exposée à part via `apiPresent`.
      return { available: rows.length > 0, apiPresent: true, tools: rows }
    }
    await delay(250)
  }
}

async function scrollThrough(target, { steps = 8, pauseMs = 250 } = {}) {
  const total = Math.max(1, Math.min(40, Number(steps)))
  const pause = Math.max(0, Math.min(2000, Number(pauseMs)))
  let previous = -1
  for (let index = 0; index < total; index += 1) {
    const metrics = await target
      .callFunction((step) => {
        const height = document.documentElement.scrollHeight
        const viewport = window.innerHeight
        window.scrollTo(0, Math.min(height, (step + 1) * viewport * 0.85))
        return { height, viewport }
      }, index)
      .catch(() => ({ height: 0, viewport: 720 }))
    if (pause) await delay(pause)
    if (metrics.height === previous && index > 1) break
    previous = metrics.height
  }
  await target.evaluate('window.scrollTo(0, 0)').catch(() => {})
}

// Un texte présent dans le DOM mais jamais amené à l'écran ne compte pas : on
// le fait défiler jusqu'à la fenêtre et on vérifie sa boîte. Tout se passe dans
// la page, en un seul aller-retour CDP.
function visibleTextChecks(patterns) {
  // Le libellé d'un champ vit dans son attribut `placeholder` (ou `aria-label`,
  // `title`, `value`), jamais dans son `textContent` : sans ces attributs, vérifier
  // une recherche ou un email par son texte donne un faux négatif. On ignore en
  // retour les balises non textuelles (`script`, `style`, …), dont les payloads
  // matchent des motifs par hasard.
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'TITLE'])
  const describe = (element) => {
    const parts = [element.textContent || '']
    for (const name of ['placeholder', 'aria-label', 'title']) parts.push(element.getAttribute?.(name) || '')
    if (typeof element.value === 'string') parts.push(element.value)
    return parts.join('\n')
  }
  const findMatches = (re) => {
    const test = (element) => !SKIP_TAGS.has(element.tagName) && re.test(describe(element))
    const out = []
    const visit = (element) => {
      if (!test(element)) return
      let descended = false
      for (const child of element.children) {
        if (test(child)) {
          descended = true
          visit(child)
        }
      }
      if (!descended) out.push(element)
    }
    if (document.body) visit(document.body)
    return out
  }
  return patterns.map((pattern) => {
    let re
    try {
      re = new RegExp(pattern, 'i')
    } catch {
      return { pattern, found: 0, visible: false, inViewport: false, error: 'regex-invalide' }
    }
    const matches = findMatches(re)
    let visible = false
    let inViewport = false
    for (const element of matches.slice(0, 8)) {
      const style = window.getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue
      let rect = element.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      try {
        element.scrollIntoView({ block: 'center', inline: 'center' })
      } catch {
        // Défilement impossible : on garde la mesure précédente.
      }
      rect = element.getBoundingClientRect()
      const intersects =
        rect.bottom >= 0 && rect.top <= window.innerHeight && rect.right >= 0 && rect.left <= window.innerWidth
      if (intersects) {
        visible = true
        inViewport = true
        break
      }
      visible = true
    }
    return { pattern, found: matches.length, visible, inViewport }
  })
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
      if (page) await page.close().catch(() => {})
      page = null
      const target = await activePage()
      await target.goto(url, { timeoutMs: 45000 })
      await delay(1500)
      const listed = await listWebMcpTools(target)
      return textResult({
        url: await target.url(),
        title: await target.title().catch(() => ''),
        webmcpAvailable: listed.available,
        webmcpApiPresent: listed.apiPresent,
        tools: listed.tools,
        ...(listed.available
          ? {}
          : {
              reason:
                listed.reason ??
                'document.modelContext présent mais aucun outil WebMCP enregistré (repli lecture seule)',
            }),
      })
    }
    case 'webmcp_list_tools': {
      const target = await activePage()
      const listed = await listWebMcpTools(target)
      return textResult({ url: await target.url(), ...listed })
    }
    case 'webmcp_call_tool': {
      const tool = String(args.tool || '').trim()
      if (!tool) throw new Error('tool requis')
      const input = args.arguments && typeof args.arguments === 'object' ? args.arguments : {}
      const target = await activePage()
      const started = performance.now()
      const previous = target.acceptDialog
      target.acceptDialog = typeof args.confirm === 'boolean' ? args.confirm : CONFIRM_DEFAULT
      target.dialog = null
      try {
        const listed = await listWebMcpTools(target, { waitFor: tool })
        if (!listed.tools.some((row) => row.name === tool)) {
          return textResult(
            { ok: false, error: `Outil WebMCP introuvable : ${tool}`, available: listed.tools.map((row) => row.name) },
            true,
          )
        }
        const execution = await target.callFunction(async ({ name: toolName, value }) => {
          const rows = await document.modelContext.getTools()
          const found = rows.find((row) => row.name === toolName)
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
        }, { name: tool, value: input })
        return textResult(
          {
            ok: execution.ok === true,
            tool,
            arguments: input,
            result: execution.result ?? null,
            dialog: target.dialog,
            url: await target.url(),
            durationMs: Math.round(performance.now() - started),
            ...(execution.ok ? {} : { error: execution.error, firstError: execution.firstError }),
          },
          execution.ok !== true,
        )
      } finally {
        target.acceptDialog = previous
      }
    }
    case 'webmcp_read_page': {
      const target = await activePage()
      if (args.url) {
        await target.goto(String(args.url), { timeoutMs: 45000 }).catch(() => {})
        await delay(1200)
      }
      await scrollThrough(target)
      const text = await target.bodyText()
      const expected = Array.isArray(args.expected) ? args.expected.map((item) => String(item)) : []
      const checks = expected.length ? await target.callFunction(visibleTextChecks, expected).catch(() => []) : []
      return textResult({
        url: await target.url(),
        title: await target.title().catch(() => ''),
        text: String(text).replace(/\s+\n/g, '\n').slice(0, 8000),
        visible: checks,
        consoleErrors: [...new Set(target.consoleErrors)].slice(0, 12),
        httpErrors: target.httpErrors.slice(0, 12),
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
    if (browser) await browser.close()
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
