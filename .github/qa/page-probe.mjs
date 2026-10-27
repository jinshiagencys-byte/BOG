/**
 * Sonde de page indépendante du modèle.
 *
 * fastbrowse/Jev décide du parcours. Cette sonde répond à deux questions que le
 * verdict de l'agent ne mesure pas : « le contenu attendu est-il réellement
 * affiché ? » et « combien de temps le client a-t-il attendu ? ».
 *
 * Elle utilise Google Chrome via `playwright-core`, installé à côté du runner
 * (ou exposé par NODE_PATH en CI). Aucun réseau social, aucun secret :
 * uniquement l'URL cible.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

const require = createRequire(import.meta.url)

function loadPlaywright(probeDir) {
  for (const name of ['playwright-core', 'patchright']) {
    try {
      const mod = require(join(probeDir, 'node_modules', name))
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
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export async function openProbe(probeDir) {
  const playwright = loadPlaywright(probeDir)
  if (!playwright) {
    return { available: false, reason: 'playwright-core introuvable (installe-le ou définis NODE_PATH)' }
  }
  const executablePath = chromePath()
  if (!executablePath) {
    return { available: false, reason: 'Google Chrome introuvable' }
  }
  try {
    const browser = await playwright.chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--enable-features=WebMCPTesting'],
    })
    return { available: true, browser, executablePath }
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function probeUrl(probe, options) {
  if (!probe?.available) {
    return { available: false, reason: probe?.reason ?? 'sonde indisponible' }
  }

  const {
    url,
    text = [],
    failIfText = [],
    maxContentMs = 5000,
    maxWaitMs = 15000,
  } = options

  const context = await probe.browser.newContext({
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => {
    consoleErrors.push(`Uncaught: ${error.message}`)
  })

  const started = performance.now()
  let httpStatus = null
  let navError = null
  let textContent = ''
  let contentMs = null
  let matched = false
  let negative = null

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    httpStatus = response?.status() ?? null
  } catch (error) {
    navError = error instanceof Error ? error.message : String(error)
  }

  const expected = text.map((pattern) => new RegExp(pattern, 'i'))
  const forbidden = failIfText.map((pattern) => new RegExp(pattern, 'i'))

  async function waitForContent(until) {
    let lastText = ''
    while (true) {
      try {
        lastText = await page.locator('body').innerText({ timeout: 1500 })
      } catch {
        lastText = ''
      }
      if (expected.length === 0 || expected.every((re) => re.test(lastText))) {
        return { matched: true, text: lastText }
      }
      if (performance.now() >= until) return { matched: false, text: lastText }
      await page.waitForTimeout(200)
    }
  }

  const first = await waitForContent(started + maxWaitMs)
  textContent = first.text
  matched = first.matched
  if (matched) contentMs = Math.round(performance.now() - started)

  let reloadContentMs = null
  let reloadMatched = false
  if (matched) {
    const reloadStarted = performance.now()
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
    } catch {
      // Le contrôle de contenu ci-dessous dira si le rechargement a abouti.
    }
    const second = await waitForContent(reloadStarted + maxWaitMs)
    textContent = second.text
    reloadMatched = second.matched
    if (reloadMatched) reloadContentMs = Math.round(performance.now() - reloadStarted)
  }

  if (!textContent) {
    try {
      textContent = await page.locator('body').innerText({ timeout: 1500 })
    } catch {
      textContent = ''
    }
  }

  for (const re of forbidden) {
    const hit = re.exec(textContent)
    if (hit) {
      negative = hit[0]
      break
    }
  }

  const finalUrl = page.url()
  const durationMs = Math.round(performance.now() - started)

  // WebMCP : si la cible expose des outils (Chrome 149+ avec le flag), on les
  // remonte pour que le runner puisse les exploiter. Aucune exécution ici.
  const webmcp = await page
    .evaluate(async () => {
      if (!document.modelContext || typeof document.modelContext.getTools !== 'function') {
        return { available: false, tools: [] }
      }
      try {
        const tools = await document.modelContext.getTools()
        return {
          available: true,
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description ?? '',
            read_only: tool.annotations?.readOnlyHint ?? null,
            consequential: tool.annotations?.consequentialHint ?? null,
          })),
        }
      } catch (error) {
        return { available: true, tools: [], error: String(error?.message ?? error) }
      }
    })
    .catch((error) => ({ available: false, tools: [], error: String(error?.message ?? error) }))

  await context.close().catch(() => {})

  return {
    available: true,
    url: finalUrl,
    httpStatus,
    navError,
    contentMs,
    reloadContentMs,
    durationMs,
    maxContentMs,
    maxWaitMs,
    matched,
    reloadMatched,
    negative,
    text: textContent.slice(0, 8000),
    consoleErrors: [...new Set(consoleErrors)].slice(0, 12),
    webmcp,
  }
}
