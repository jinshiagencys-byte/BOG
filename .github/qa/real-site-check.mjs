#!/usr/bin/env node
/**
 * Test QA sur un site RÉEL — sans Playwright, sans LLM, sans secret.
 *
 * Ce n'est pas la page de démonstration locale (`webmcp-demo.html`, réservée à
 * l'auto-test du serveur MCP) : on ouvre ici une vraie URL publique, on la fait
 * défiler et on vérifie des faits déterministes :
 *   • HTTP du document, titre, langue, erreurs console ;
 *   • chaque texte / sélecteur attendu est **réellement visible** à l'écran
 *     (un élément présent dans le DOM mais jamais affiché ne compte pas).
 *
 * La capture d'écran et le rapport JSON sont écrits dans `QA_OUTPUT_DIR`.
 * Une absence d'outil WebMCP n'est PAS un échec : c'est l'état normal d'un site
 * qui n'instrumente pas WebMCP ; on le remonte à titre informatif.
 *
 * Variables :
 *   REAL_SITE_URL                 URL à tester (défaut https://markhorusbj.com)
 *   REAL_SITE_TITLE               motif regex attendu dans le titre (insensible à la casse)
 *   REAL_SITE_LANG                valeur attendue de <html lang>
 *   REAL_SITE_VISIBLE             JSON : motifs texte devant être visibles
 *   REAL_SITE_SELECTORS           JSON : [{ label, selector, text? }] devant être visibles
 *   REAL_SITE_MAX_CONSOLE_ERRORS  défaut 0
 *   REAL_SITE_CONTENT_TIMEOUT_MS  défaut 30000
 *   REAL_SITE_MIN_TEXT            longueur minimale du texte visible (défaut 50)
 *   QA_OUTPUT_DIR                 défaut .qa-out
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './cdp-client.mjs'

const URL_TARGET = process.env.REAL_SITE_URL?.trim() || 'https://markhorusbj.com'
const OUT_DIR = process.env.QA_OUTPUT_DIR?.trim() || '.qa-out'
const MAX_CONSOLE_ERRORS = Number(process.env.REAL_SITE_MAX_CONSOLE_ERRORS ?? 0)
const CONTENT_TIMEOUT_MS = Number(process.env.REAL_SITE_CONTENT_TIMEOUT_MS ?? 30000)
const MIN_TEXT = Number(process.env.REAL_SITE_MIN_TEXT ?? 50)

function parseJsonEnv(name, fallback) {
  const raw = process.env[name]
  if (!raw) return fallback
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? value : fallback
  } catch {
    console.error(`[real-site] ${name} : JSON invalide, ignoré`)
    return fallback
  }
}

const EXPECT_TITLE = process.env.REAL_SITE_TITLE?.trim() || null
const EXPECT_LANG = process.env.REAL_SITE_LANG?.trim() || null
const VISIBLE_PATTERNS = parseJsonEnv('REAL_SITE_VISIBLE', [])
const VISIBLE_SELECTORS = parseJsonEnv('REAL_SITE_SELECTORS', [])

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 22) {
  console.error(`Node ${process.versions.node} : le WebSocket global exige Node >= 22.`)
  process.exit(1)
}

const checks = []
const record = (name, ok, detail = '') => {
  checks.push({ name, status: ok ? 'passed' : 'failed', detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

// Fonctions exécutées dans la page (sérialisées : aucune variable extérieure).
function visiblePatterns(patterns) {
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'TITLE'])
  const describe = (element) => {
    const parts = [element.textContent || '']
    for (const name of ['placeholder', 'aria-label', 'title']) parts.push(element.getAttribute?.(name) || '')
    if (typeof element.value === 'string') parts.push(element.value)
    return parts.join('\n')
  }
  const matchesOf = (re) => {
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
    const matches = matchesOf(re)
    let visible = false
    let inViewport = false
    for (const element of matches.slice(0, 8)) {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue
      let rect = element.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      try {
        element.scrollIntoView({ block: 'center', inline: 'center' })
      } catch {
        // Défilement impossible : on garde la mesure précédente.
      }
      rect = element.getBoundingClientRect()
      if (
        rect.bottom >= 0 &&
        rect.top <= window.innerHeight &&
        rect.right >= 0 &&
        rect.left <= window.innerWidth
      ) {
        visible = true
        inViewport = true
        break
      }
      visible = true
    }
    return { pattern, found: matches.length, visible, inViewport }
  })
}

function visibleSelectors(items) {
  return items.map((item) => {
    const element = document.querySelector(item.selector)
    if (!element) return { label: item.label, selector: item.selector, found: false, visible: false }
    const style = getComputedStyle(element)
    let rect = element.getBoundingClientRect()
    const painted = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
    if (painted && rect.width > 0 && rect.height > 0) {
      try {
        element.scrollIntoView({ block: 'center' })
      } catch {
        // On garde la mesure précédente.
      }
      rect = element.getBoundingClientRect()
    }
    const visible = painted && rect.width > 0 && rect.height > 0
    const inViewport = visible && rect.bottom >= 0 && rect.top <= window.innerHeight
    const text = (element.innerText || element.getAttribute?.('placeholder') || '').trim().slice(0, 80)
    const textOk = item.text ? new RegExp(item.text, 'i').test(text) : true
    return { label: item.label, selector: item.selector, found: true, visible, inViewport, text, textOk }
  })
}

console.log(`Cible : ${URL_TARGET}`)

const browser = await launchBrowser({ headless: true })
const page = await browser.newPage()
await page.connection
  .send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, page.sessionId)
  .catch(() => {})

let httpStatus = null
page.connection.on('Network.responseReceived', (params, sid) => {
  if (sid !== page.sessionId || params.type !== 'Document') return
  if (Number.isInteger(params.response?.status)) httpStatus = params.response.status
})

const started = Date.now()
let navError = null
try {
  await page.goto(URL_TARGET, { timeoutMs: 60000 })
} catch (error) {
  navError = error.message
}

// Attendre que le contenu visible se stabilise (sites fortement JS).
let bodyText = ''
const deadline = Date.now() + CONTENT_TIMEOUT_MS
while (Date.now() < deadline) {
  bodyText = await page.bodyText().catch(() => '')
  if (bodyText.trim().length >= MIN_TEXT) break
  await delay(500)
}

const finalUrl = await page.url().catch(() => URL_TARGET)
const title = await page.title().catch(() => '')
const lang = await page.evaluate('document.documentElement.lang || ""').catch(() => '')

record('navigation', !navError, navError ?? finalUrl)
record('http_document', httpStatus === 200, `HTTP ${httpStatus}`)
record(
  'titre',
  EXPECT_TITLE ? new RegExp(EXPECT_TITLE, 'i').test(title) : title.trim().length > 0,
  `"${title}"`,
)
if (EXPECT_LANG) record('langue', lang === EXPECT_LANG, `lang="${lang}"`)
record('texte_visible', bodyText.trim().length >= MIN_TEXT, `${bodyText.trim().length} caractère(s)`)
record(
  'erreurs_console',
  page.consoleErrors.length <= MAX_CONSOLE_ERRORS,
  `${page.consoleErrors.length} erreur(s)`,
)

if (VISIBLE_PATTERNS.length) {
  const results = await page.callFunction(visiblePatterns, VISIBLE_PATTERNS).catch(() => [])
  for (const item of results) {
    record(
      `visible:"${item.pattern}"`,
      item.visible === true,
      item.error ? item.error : `found=${item.found} inViewport=${item.inViewport}`,
    )
  }
}

if (VISIBLE_SELECTORS.length) {
  const results = await page.callFunction(visibleSelectors, VISIBLE_SELECTORS).catch(() => [])
  for (const item of results) {
    record(
      `selecteur:${item.label}`,
      item.visible === true && item.textOk !== false,
      `found=${item.found} visible=${item.visible} inViewport=${item.inViewport} text="${item.text}"`,
    )
  }
}

const webmcp = await page
  .callFunction(async () => {
    if (!document.modelContext || typeof document.modelContext.getTools !== 'function') {
      return { apiPresent: false, tools: [] }
    }
    try {
      const tools = await document.modelContext.getTools()
      return { apiPresent: true, tools: (tools ?? []).map((tool) => tool.name) }
    } catch (error) {
      return { apiPresent: true, tools: [], error: String(error?.message ?? error) }
    }
  })
  .catch(() => ({ apiPresent: null, tools: [] }))
console.log(
  `  ℹ outils WebMCP : ${webmcp.tools.length}${webmcp.apiPresent === false ? ' (API absente)' : ''}` +
    (webmcp.tools.length ? ` → ${webmcp.tools.join(', ')}` : ' → repli lecture seule'),
)

let screenshot = null
try {
  const capture = await page.connection.send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: true },
    page.sessionId,
  )
  mkdirSync(OUT_DIR, { recursive: true })
  screenshot = join(OUT_DIR, 'screenshot.png')
  writeFileSync(screenshot, Buffer.from(capture.data, 'base64'))
} catch (error) {
  console.log(`  ⚠ capture d'écran impossible : ${error.message}`)
}

await browser.close().catch(() => {})

const failed = checks.filter((check) => check.status === 'failed').length
const report = {
  url: finalUrl,
  requestedUrl: URL_TARGET,
  httpStatus,
  title,
  lang,
  durationMs: Date.now() - started,
  consoleErrors: [...new Set(page.consoleErrors)].slice(0, 12),
  httpErrors: page.httpErrors.slice(0, 12),
  webmcp,
  screenshot,
  checks,
  passed: checks.length - failed,
  failed,
  total: checks.length,
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)

console.log('')
console.log(`${report.passed} vérification(s) réussie(s), ${failed} échec(s) — cible ${finalUrl}`)
if (failed > 0) {
  console.log(`✗ Échecs : ${checks.filter((c) => c.status === 'failed').map((c) => c.name).join(', ')}`)
  process.exit(1)
}
console.log(`✅ Site réel OK — preuves dans ${OUT_DIR}`)
process.exit(0)
