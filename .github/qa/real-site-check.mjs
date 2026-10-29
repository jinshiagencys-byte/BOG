#!/usr/bin/env node
/**
 * Test QA sur un site RÉEL — sans Playwright, sans LLM, sans secret.
 *
 * Ce n'est pas la page de démonstration locale (`webmcp-demo.html`, réservée à
 * l'auto-test du serveur MCP) : on ouvre ici une vraie URL publique, on la fait
 * défiler et on vérifie des faits déterministes :
 *   • HTTP du document, titre, langue, erreurs console ;
 *   • **ressources JS effectivement chargées** — une page servie en 429/5xx sur
 *     ses scripts est une coquille rendue côté serveur, pas un site qui marche :
 *     on refuse de la valider ;
 *   • **application hydratée** (facultatif mais actif par défaut) ;
 *   • chaque texte / sélecteur attendu est **réellement visible** à l'écran
 *     (un élément présent dans le DOM mais jamais affiché ne compte pas) ;
 *   • éventuellement, une **interaction** (saisie / clic) produit un changement.
 *
 * La capture d'écran et le rapport JSON sont écrits dans `QA_OUTPUT_DIR`.
 * Une absence d'outil WebMCP n'est PAS un échec : c'est l'état normal d'un site
 * qui n'instrumente pas WebMCP ; on le remonte à titre informatif.
 *
 * Variables :
 *   REAL_SITE_URL                    défaut https://markhorusbj.com
 *   REAL_SITE_TITLE                  motif regex attendu dans le titre
 *   REAL_SITE_LANG                   valeur attendue de <html lang>
 *   REAL_SITE_VISIBLE                JSON : motifs texte devant être visibles
 *   REAL_SITE_SELECTORS              JSON : [{ label, selector, text? }] visibles
 *   REAL_SITE_INTERACTIONS           JSON : [{ label, selector, value?, watch?, expect?, waitMs? }]
 *   REAL_SITE_MAX_CONSOLE_ERRORS     défaut 0
 *   REAL_SITE_CONTENT_TIMEOUT_MS     défaut 30000
 *   REAL_SITE_MIN_TEXT               défaut 50
 *   REAL_SITE_FAIL_ON_JS_ERRORS      défaut true  (JS/script en 4xx/5xx = échec)
 *   REAL_SITE_REQUIRE_HYDRATION      défaut true  (application non montée = échec)
 *   REAL_SITE_APP_SELECTOR           défaut "#__nuxt, #app, [data-v-app]"
 *   REAL_SITE_HYDRATION_TIMEOUT_MS   défaut 25000
 *   QA_OUTPUT_DIR                    défaut qa-out
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './cdp-client.mjs'

const bool = (value, fallback) => (value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase()))

const URL_TARGET = process.env.REAL_SITE_URL?.trim() || 'https://markhorusbj.com'
const OUT_DIR = process.env.QA_OUTPUT_DIR?.trim() || 'qa-out'
const MAX_CONSOLE_ERRORS = Number(process.env.REAL_SITE_MAX_CONSOLE_ERRORS ?? 0)
const CONTENT_TIMEOUT_MS = Number(process.env.REAL_SITE_CONTENT_TIMEOUT_MS ?? 30000)
const MIN_TEXT = Number(process.env.REAL_SITE_MIN_TEXT ?? 50)
const FAIL_ON_JS_ERRORS = bool(process.env.REAL_SITE_FAIL_ON_JS_ERRORS, true)
const REQUIRE_HYDRATION = bool(process.env.REAL_SITE_REQUIRE_HYDRATION, true)
const APP_SELECTOR = process.env.REAL_SITE_APP_SELECTOR?.trim() || '#__nuxt, #app, [data-v-app]'
const HYDRATION_TIMEOUT_MS = Number(process.env.REAL_SITE_HYDRATION_TIMEOUT_MS ?? 25000)

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
const INTERACTIONS = parseJsonEnv('REAL_SITE_INTERACTIONS', [])

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

// --- fonctions exécutées dans la page (sérialisées : aucune variable extérieure)

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
      if (rect.bottom >= 0 && rect.top <= window.innerHeight && rect.right >= 0 && rect.left <= window.innerWidth) {
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

/** L'application a-t-elle réellement monté (Vue `__vue_app__`, `data-v-app`, DOM réactif) ? */
function appMounted(selector) {
  const roots = Array.from(document.querySelectorAll(selector))
  return roots.some((root) => root.__vue_app__ || root.hasAttribute('data-v-app') || root.__reactRoot || root.__svelte_meta)
}

/** Saisit / clique, puis vérifie qu'un changement visible se produit. */
function interactionProbe(items) {
  const snapshot = () => (document.body ? document.body.innerText.replace(/\s+/g, ' ').trim() : '')
  return (async () => {
    const out = []
    for (const item of items) {
      const element = document.querySelector(item.selector)
      if (!element) {
        out.push({ label: item.label, ok: false, reason: 'introuvable' })
        continue
      }
      const read = () => (item.watch ? document.querySelector(item.watch)?.innerText || '' : snapshot())
      const before = read()
      element.scrollIntoView({ block: 'center' })
      if (item.value !== undefined) {
        element.focus()
        element.value = item.value
        element.dispatchEvent(new Event('input', { bubbles: true }))
        element.dispatchEvent(new Event('change', { bubbles: true }))
      } else {
        element.click()
      }
      await new Promise((resolve) => setTimeout(resolve, Number(item.waitMs ?? 1500)))
      const after = read()
      const changed = before !== after
      const matched = item.expect ? new RegExp(item.expect, 'i').test(after) : true
      out.push({ label: item.label, ok: changed && matched, changed, matched, sample: after.slice(0, 120) })
    }
    return out
  })()
}

// --- exécution

console.log(`Cible : ${URL_TARGET}`)

const browser = await launchBrowser({ headless: true })
const page = await browser.newPage()
await page.connection
  .send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, page.sessionId)
  .catch(() => {})

const started = Date.now()
let httpStatus = null
const resources = []
page.connection.on('Network.responseReceived', (params, sid) => {
  if (sid !== page.sessionId) return
  const status = params.response?.status ?? 0
  const type = String(params.type ?? '')
  const url = String(params.response?.url ?? '')
  resources.push({ type, status, url })
  if (type === 'Document') httpStatus = status
})

let navError = null
try {
  await page.goto(URL_TARGET, { timeoutMs: 60000 })
} catch (error) {
  navError = error.message
}

// Attente du contenu visible (sites fortement JS).
let bodyText = ''
const contentDeadline = Date.now() + CONTENT_TIMEOUT_MS
while (Date.now() < contentDeadline) {
  bodyText = await page.bodyText().catch(() => '')
  if (bodyText.trim().length >= MIN_TEXT) break
  await delay(500)
}

// Attente de l'hydratation (l'application doit finir de monter).
let mounted = false
const hydrationDeadline = Date.now() + HYDRATION_TIMEOUT_MS
while (Date.now() < hydrationDeadline) {
  mounted = await page.callFunction(appMounted, APP_SELECTOR).catch(() => false)
  if (mounted) break
  await delay(500)
}

const finalUrl = await page.url().catch(() => URL_TARGET)
const title = await page.title().catch(() => '')
const lang = await page.evaluate('document.documentElement.lang || ""').catch(() => '')

const scriptResources = resources.filter((r) => r.type === 'Script' || /\.m?js(\?|$)/.test(r.url))
const scriptFailures = scriptResources.filter((r) => r.status >= 400)
const byStatus = {}
for (const r of resources) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1

record('navigation', !navError, navError ?? finalUrl)
record('http_document', httpStatus === 200, `HTTP ${httpStatus}`)
record('titre', EXPECT_TITLE ? new RegExp(EXPECT_TITLE, 'i').test(title) : title.trim().length > 0, `"${title}"`)
if (EXPECT_LANG) record('langue', lang === EXPECT_LANG, `lang="${lang}"`)
record('texte_visible', bodyText.trim().length >= MIN_TEXT, `${bodyText.trim().length} caractère(s)`)
record('erreurs_console', page.consoleErrors.length <= MAX_CONSOLE_ERRORS, `${page.consoleErrors.length} erreur(s)`)
record(
  'ressources_js',
  FAIL_ON_JS_ERRORS ? scriptFailures.length === 0 : true,
  `${scriptResources.length - scriptFailures.length}/${scriptResources.length} JS chargés` +
    (scriptFailures.length ? ` — ${scriptFailures.length} en échec (ex. HTTP ${scriptFailures[0].status})` : ''),
)
record(
  'application_montee',
  REQUIRE_HYDRATION ? mounted === true : true,
  mounted ? 'hydratée' : `non détectée (${APP_SELECTOR})`,
)
console.log(`  ℹ requêtes : ${resources.length} — statuts ${JSON.stringify(byStatus)}`)

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

if (INTERACTIONS.length) {
  const results = await page.callFunction(interactionProbe, INTERACTIONS).catch(() => [])
  for (const item of results) {
    record(
      `interaction:${item.label}`,
      item.ok === true,
      item.reason ? item.reason : `changed=${item.changed} matched=${item.matched} → "${item.sample}"`,
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
  const capture = await page.connection.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, page.sessionId)
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
  mounted,
  durationMs: Date.now() - started,
  resources: { total: resources.length, byStatus, scripts: scriptResources.length, scriptFailures: scriptFailures.length },
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
