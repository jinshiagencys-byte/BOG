/**
 * Client Chrome DevTools Protocol minimal — sans dépendance.
 *
 * Playwright servait ici de simple client CDP : la sonde de fastbrowse et le
 * serveur MCP WebMCP ne s'en servaient que pour parler à Chrome. Ce module
 * remplace cette dépendance par le `WebSocket` global de Node (>= 22) et le
 * protocole « flattened » de CDP : on envoie des commandes et on écoute des
 * événements, sans API de haut niveau et sans scénario.
 *
 * Deux modes, comme avant :
 *   • `connectBrowser('http://127.0.0.1:9222')` se branche sur un Chrome déjà
 *     lancé (celui du run) ;
 *   • `launchBrowser()` démarre son propre Chrome headless.
 *
 * Le flag `--enable-features=WebMCPTesting` est indispensable : sans lui,
 * `document.modelContext` n'existe pas dans Chrome stable.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const WEBMCP_FLAGS = ['--enable-features=WebMCPTesting']

export function chromeExecutable(extraPath = null) {
  const candidates = [
    extraPath,
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function openWebSocket(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let socket
    try {
      socket = new WebSocket(url)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    const timer = setTimeout(() => reject(new Error(`WebSocket ${url} : délai dépassé`)), timeoutMs)
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer)
        resolve(socket)
      },
      { once: true },
    )
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer)
        reject(new Error(`WebSocket ${url} : connexion impossible`))
      },
      { once: true },
    )
  })
}

export class CdpConnection {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    this.closed = false
    socket.addEventListener('message', (event) => this.#dispatch(event.data))
    socket.addEventListener('close', () => this.#fail(new Error('connexion CDP fermée')))
    socket.addEventListener('error', () => this.#fail(new Error('erreur de connexion CDP')))
  }

  #dispatch(raw) {
    let message
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : String(raw))
    } catch {
      return
    }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id)
      this.pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`))
      else entry.resolve(message.result ?? {})
      return
    }
    if (message.method) {
      const handlers = this.listeners.get(message.method)
      if (!handlers) return
      for (const handler of handlers) {
        try {
          handler(message.params ?? {}, message.sessionId)
        } catch {
          // Un écouteur fautif ne doit pas interrompre le flux CDP.
        }
      }
    }
  }

  #fail(error) {
    this.closed = true
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pending.clear()
  }

  send(method, params = {}, sessionId, { timeoutMs = 60000 } = {}) {
    if (this.closed) return Promise.reject(new Error('connexion CDP fermée'))
    const id = this.nextId++
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP ${method} : délai dépassé (${timeoutMs} ms)`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify(payload))
    })
  }

  /** Enregistre un écouteur ; renvoie la fonction de désabonnement. */
  on(method, handler) {
    let handlers = this.listeners.get(method)
    if (!handlers) {
      handlers = new Set()
      this.listeners.set(method, handlers)
    }
    handlers.add(handler)
    return () => handlers.delete(handler)
  }

  close() {
    try {
      this.socket.close()
    } catch {
      // Déjà fermé.
    }
  }
}

export class CdpPage {
  constructor(connection, targetId, sessionId) {
    this.connection = connection
    this.targetId = targetId
    this.sessionId = sessionId
    this.enabled = false
    this.consoleErrors = []
    this.httpErrors = []
    this.dialog = null
    this.acceptDialog = false
    this._onDialog = null
  }

  static async create(connection, { url = 'about:blank' } = {}) {
    const { targetId } = await connection.send('Target.createTarget', { url })
    const { sessionId } = await connection.send('Target.attachToTarget', { targetId, flatten: true })
    const page = new CdpPage(connection, targetId, sessionId)
    await page.enable()
    return page
  }

  async enable() {
    if (this.enabled) return
    this.enabled = true
    const sessionId = this.sessionId
    const mine = (sid) => sid === sessionId

    this.connection.on('Runtime.consoleAPICalled', (params, sid) => {
      if (!mine(sid) || params.type !== 'error' || this.consoleErrors.length >= 25) return
      const text = (params.args ?? [])
        .map((arg) => arg.value ?? arg.description ?? (arg.preview ? JSON.stringify(arg.preview) : ''))
        .filter(Boolean)
        .join(' ')
      if (text) this.consoleErrors.push(text.slice(0, 300))
    })
    this.connection.on('Runtime.exceptionThrown', (params, sid) => {
      if (!mine(sid) || this.consoleErrors.length >= 25) return
      const details = params.exceptionDetails ?? {}
      const text = details.exception?.description ?? details.text ?? 'exception'
      this.consoleErrors.push(`Uncaught: ${String(text).split('\n')[0]}`.slice(0, 300))
    })
    this.connection.on('Network.responseReceived', (params, sid) => {
      if (!mine(sid)) return
      const response = params.response ?? {}
      if ((response.status ?? 0) < 400 || this.httpErrors.length >= 30) return
      this.httpErrors.push({ status: response.status, url: String(response.url ?? '').slice(0, 300) })
    })
    // Les mutations WebMCP passent par `window.confirm` : la politique est
    // « refuser » par défaut, l'appelant doit l'accepter explicitement.
    this.connection.on('Page.javascriptDialogOpening', (params, sid) => {
      if (!mine(sid)) return
      const accepted = this.acceptDialog === true
      this.dialog = { type: params.type, message: params.message, accepted }
      this.connection
        .send('Page.handleJavaScriptDialog', { accept: accepted }, sessionId)
        .catch(() => this.connection.send('Page.handleJavaScriptDialog', { accept: accepted }))
    })

    await this.connection.send('Page.enable', {}, sessionId)
    await this.connection.send('Runtime.enable', {}, sessionId)
    await this.connection.send('Network.enable', {}, sessionId)
  }

  waitForEvent(method, predicate = null, timeoutMs = 45000) {
    return new Promise((resolve) => {
      const off = this.connection.on(method, (params, sid) => {
        if (sid !== this.sessionId) return
        if (predicate && !predicate(params)) return
        off()
        clearTimeout(timer)
        resolve(params)
      })
      const timer = setTimeout(() => {
        off()
        resolve(null)
      }, timeoutMs)
      timer.unref?.()
    })
  }

  async goto(url, { timeoutMs = 45000 } = {}) {
    await this.enable()
    const loaded = this.waitForEvent('Page.loadEventFired', null, timeoutMs)
    const result = await this.connection.send('Page.navigate', { url }, this.sessionId, { timeoutMs })
    if (result?.errorText && !/ERR_ABORTED/.test(result.errorText)) {
      throw new Error(`navigation échouée : ${result.errorText}`)
    }
    await loaded
    return result
  }

  async reload({ timeoutMs = 45000 } = {}) {
    const loaded = this.waitForEvent('Page.loadEventFired', null, timeoutMs)
    await this.connection.send('Page.reload', {}, this.sessionId, { timeoutMs })
    await loaded
  }

  async evaluate(expression, { timeoutMs = 30000, awaitPromise = true, userGesture = false } = {}) {
    const result = await this.connection.send(
      'Runtime.evaluate',
      {
        expression,
        awaitPromise,
        returnByValue: true,
        userGesture,
        allowUnsafeEvalBlockedByCSP: false,
      },
      this.sessionId,
      { timeoutMs },
    )
    if (result.exceptionDetails) {
      const description =
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'exception'
      throw new Error(String(description).split('\n')[0])
    }
    return result.result?.value
  }

  /** Appelle une fonction JS autonome avec des arguments sérialisés en JSON. */
  callFunction(fn, ...args) {
    const params = args.map((arg) => JSON.stringify(arg)).join(',')
    return this.evaluate(`(${fn.toString()})(${params})`)
  }

  async title() {
    return (await this.evaluate('document.title')) ?? ''
  }

  async url() {
    return (await this.evaluate('location.href')) ?? ''
  }

  async bodyText() {
    try {
      return (await this.evaluate('document.body ? document.body.innerText : ""')) ?? ''
    } catch {
      return ''
    }
  }

  async viewport() {
    try {
      const size = await this.callFunction(() => ({ width: window.innerWidth, height: window.innerHeight }))
      return size ?? { width: 1280, height: 720 }
    } catch {
      return { width: 1280, height: 720 }
    }
  }

  async applyStorageState(state) {
    if (!state || typeof state !== 'object') return
    const cookies = Array.isArray(state.cookies) ? state.cookies : []
    if (cookies.length > 0) {
      await this.connection
        .send(
          'Network.setCookies',
          {
            cookies: cookies.map((cookie) => ({
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain,
              path: cookie.path ?? '/',
              ...(cookie.expires ? { expires: cookie.expires } : {}),
              httpOnly: cookie.httpOnly === true,
              secure: cookie.secure === true,
              ...(cookie.sameSite && cookie.sameSite !== 'None' ? { sameSite: cookie.sameSite } : {}),
            })),
          },
          this.sessionId,
        )
        .catch(() => {})
    }
    for (const origin of Array.isArray(state.origins) ? state.origins : []) {
      const entries = origin?.localStorage
      if (!Array.isArray(entries) || entries.length === 0) continue
      const source = `try{${entries
        .map((entry) => `localStorage.setItem(${JSON.stringify(entry.name)}, ${JSON.stringify(entry.value)});`)
        .join('')}}catch(e){}`
      await this.connection
        .send('Page.addScriptToEvaluateOnNewDocument', { source }, this.sessionId)
        .catch(() => {})
    }
  }

  async close() {
    try {
      await this.connection.send('Target.closeTarget', { targetId: this.targetId }, undefined, { timeoutMs: 5000 })
    } catch {
      // La cible est peut-être déjà détruite.
    }
  }
}

export class CdpBrowser {
  constructor(connection, { process: child = null, userDataDir = null, executablePath = null } = {}) {
    this.connection = connection
    this.process = child
    this.userDataDir = userDataDir
    this.executablePath = executablePath
    this.closed = false
  }

  newPage(options) {
    return CdpPage.create(this.connection, options)
  }

  async close() {
    if (this.closed) return
    this.closed = true
    // On ne ferme le navigateur que s'il nous appartient : en mode partagé
    // (`WEBMCP_CDP_URL`), ce Chrome sert aussi au sous-agent Antigravity.
    if (this.process) {
      try {
        await this.connection.send('Browser.close', {}, undefined, { timeoutMs: 5000 })
      } catch {
        // Le navigateur a pu déjà se fermer.
      }
    }
    this.connection.close()
    if (this.process && !this.process.killed) {
      try {
        this.process.kill('SIGKILL')
      } catch {
        // Déjà sorti.
      }
    }
    if (this.userDataDir) {
      try {
        rmSync(this.userDataDir, { recursive: true, force: true })
      } catch {
        // Rien à faire.
      }
    }
  }
}

async function readDevToolsActivePort(userDataDir, { timeoutMs = 20000 } = {}) {
  const file = join(userDataDir, 'DevToolsActivePort')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const lines = readFileSync(file, 'utf8').split('\n').map((line) => line.trim())
      const port = Number(lines[0])
      const path = lines[1]
      if (Number.isInteger(port) && port > 0 && path) return { port, path }
    }
    await delay(150)
  }
  throw new Error(`DevToolsActivePort introuvable dans ${userDataDir}`)
}

export async function launchBrowser({ headless = true, executablePath = null, extraArgs = [], userDataDir = null } = {}) {
  const binary = chromeExecutable(executablePath)
  if (!binary) throw new Error('Google Chrome introuvable')
  const dir = userDataDir ?? mkdtempSync(join(tmpdir(), 'qa-chrome-'))
  const args = [
    ...(headless ? ['--headless=new'] : []),
    `--user-data-dir=${dir}`,
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    ...WEBMCP_FLAGS,
    ...extraArgs,
    'about:blank',
  ]
  const child = spawn(binary, args, { stdio: 'ignore', detached: false })
  try {
    const { port, path } = await readDevToolsActivePort(dir)
    const connection = new CdpConnection(await openWebSocket(`ws://127.0.0.1:${port}${path}`))
    return new CdpBrowser(connection, { process: child, userDataDir: dir, executablePath: binary })
  } catch (error) {
    try {
      child.kill('SIGKILL')
    } catch {
      // Déjà sorti.
    }
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

export async function connectBrowser(cdpUrl) {
  const raw = String(cdpUrl || '').trim()
  if (!raw) throw new Error('URL CDP vide')
  let wsUrl = raw
  if (!/^wss?:\/\//i.test(raw)) {
    const endpoint = raw.replace(/\/+$/, '')
    const response = await fetch(`${endpoint}/json/version`)
    if (!response.ok) throw new Error(`CDP ${endpoint}/json/version : HTTP ${response.status}`)
    const info = await response.json()
    wsUrl = info.webSocketDebuggerUrl
    if (!wsUrl) throw new Error(`CDP ${endpoint} : webSocketDebuggerUrl absent`)
  }
  const connection = new CdpConnection(await openWebSocket(wsUrl))
  return new CdpBrowser(connection, {})
}

export async function openBrowser({ cdpUrl = null, ...options } = {}) {
  return cdpUrl ? connectBrowser(cdpUrl) : launchBrowser(options)
}
