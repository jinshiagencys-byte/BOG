/**
 * Sonde de page indépendante du modèle — client CDP brut, sans Playwright.
 *
 * fastbrowse/Jev décide du parcours. Cette sonde répond à deux questions que le
 * verdict de l'agent ne mesure pas : « le contenu attendu est-il réellement
 * affiché ? » et « combien de temps le client a-t-il attendu ? ».
 *
 * Elle pilote Google Chrome via `.github/qa/cdp-client.mjs` (WebSocket natif de
 * Node). Aucun réseau social, aucun secret : uniquement l'URL cible.
 */
import { performance } from 'node:perf_hooks'
import { launchBrowser } from './cdp-client.mjs'

export async function openProbe() {
  try {
    const browser = await launchBrowser({ headless: true })
    return { available: true, browser, executablePath: browser.executablePath }
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function asPatternList(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
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

  const page = await probe.browser.newPage()
  const sessionId = page.sessionId
  let httpStatus = null

  // Statut HTTP du document principal : dernier `Document` chargé.
  const offResponse = page.connection.on('Network.responseReceived', (params, sid) => {
    if (sid !== sessionId || params.type !== 'Document') return
    if (Number.isInteger(params.response?.status)) httpStatus = params.response.status
  })

  await page.connection
    .send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId)
    .catch(() => {})
  await page.connection.send('Emulation.setLocaleOverride', { locale: 'fr-FR' }, sessionId).catch(() => {})

  const started = performance.now()
  let navError = null
  let textContent = ''
  let contentMs = null
  let matched = false
  let negative = null

  try {
    await page.goto(url, { timeoutMs: 30000 })
  } catch (error) {
    navError = error instanceof Error ? error.message : String(error)
  }

  const expected = asPatternList(text).map((pattern) => new RegExp(pattern, 'i'))
  const forbidden = asPatternList(failIfText).map((pattern) => new RegExp(pattern, 'i'))

  async function waitForContent(until) {
    let lastText = ''
    while (true) {
      lastText = await page.bodyText()
      if (expected.length === 0 || expected.every((re) => re.test(lastText))) {
        return { matched: true, text: lastText }
      }
      if (performance.now() >= until) return { matched: false, text: lastText }
      await new Promise((resolve) => setTimeout(resolve, 200))
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
      await page.reload({ timeoutMs: 30000 })
    } catch {
      // Le contrôle de contenu ci-dessous dira si le rechargement a abouti.
    }
    const second = await waitForContent(reloadStarted + maxWaitMs)
    textContent = second.text
    reloadMatched = second.matched
    if (reloadMatched) reloadContentMs = Math.round(performance.now() - reloadStarted)
  }

  if (!textContent) textContent = await page.bodyText()

  for (const re of forbidden) {
    const hit = re.exec(textContent)
    if (hit) {
      negative = hit[0]
      break
    }
  }

  let finalUrl = url
  try {
    finalUrl = await page.url()
  } catch {
    // On garde l'URL demandée.
  }
  const durationMs = Math.round(performance.now() - started)

  // WebMCP : si la cible expose des outils (Chrome 149+ avec le flag), on les
  // remonte pour que le runner puisse les exploiter. Aucune exécution ici.
  let webmcp = { available: false, tools: [] }
  try {
    const listed = await page.callFunction(async () => {
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
    if (listed) webmcp = listed
  } catch {
    // La page a pu se fermer ou bloquer l'évaluation.
  }

  offResponse()
  await page.close().catch(() => {})

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
    text: String(textContent).slice(0, 8000),
    consoleErrors: [...new Set(page.consoleErrors)].slice(0, 12),
    webmcp,
  }
}
