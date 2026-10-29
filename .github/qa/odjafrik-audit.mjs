#!/usr/bin/env node
/**
 * Audit fonctionnel de bout en bout d'un site réel (par défaut odjafrik.com).
 *
 * Contrairement à une vérification de présence, chaque scénario **agit** puis
 * vérifie le résultat : ouvrir la connexion, soumettre, chercher, lister des
 * produits, atteindre une route profonde, suivre les appels d'API.
 *
 * Un 429 (rate-limit) est classé `blocked` — jamais `failed` : on ne reproche
 * pas au site ce qu'on n'a pas pu tester. Executé depuis la CI (IP propre) pour
 * éviter d'être limité par sa propre IP.
 *
 * Sortie : report.json + report.md dans QA_OUTPUT_DIR.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { launchBrowser } from './cdp-client.mjs'

const BASE = (process.env.AUDIT_BASE_URL || 'https://odjafrik.com').replace(/\/+$/, '')
const OUT = process.env.QA_OUTPUT_DIR || 'qa-out-odjafrik'
const NORMAL_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36'
const PACE_MS = Number(process.env.AUDIT_PACE_MS ?? 2500)

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 22) {
  console.error(`Node ${process.versions.node} : WebSocket global requis (>= 22).`)
  process.exit(1)
}

const results = []
const step = (name, status, detail, evidence = null) => {
  results.push({ name, status, detail, evidence })
  const icon = status === 'pass' ? '✓' : status === 'fail' ? '✗' : '•'
  console.log(`  ${icon} [${status}] ${name} — ${detail}`)
}

const browser = await launchBrowser({ headless: true, extraArgs: ['--disable-blink-features=AutomationControlled'] })

async function newPage() {
  const page = await browser.newPage()
  await page.connection.send('Network.setUserAgentOverride', { userAgent: NORMAL_UA, acceptLanguage: 'fr-FR,fr;q=0.9', platform: 'Linux x86_64' }, page.sessionId).catch(() => {})
  await page.connection.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, page.sessionId).catch(() => {})
  const api = []
  const errors = []
  page.connection.on('Network.responseReceived', (p, sid) => {
    if (sid !== page.sessionId) return
    const url = String(p.response?.url ?? '')
    const status = p.response?.status ?? 0
    if (/backoffice\.odjafrik|odjafrik\.com\/(api|auth)/.test(url) && (p.type === 'XHR' || p.type === 'Fetch' || status >= 400)) {
      api.push({ status, url: url.replace(BASE, '').slice(0, 120) })
    }
    if (status === 429) errors.push(`429 ${url.replace(BASE, '').slice(0, 90)}`)
  })
  return { page, api, errors }
}

const text = (page, sel) => page.callFunction((s) => (document.querySelector(s)?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160), sel)
const count = (page, sel) => page.callFunction((s) => document.querySelectorAll(s).length, sel)
const has429 = (api) => api.some((a) => a.status === 429)

// --- 1. Accueil -------------------------------------------------------------
{
  const { page } = await newPage()
  const resources = []
  page.connection.on('Network.responseReceived', (p, sid) => {
    if (sid === page.sessionId) resources.push({ type: p.type, status: p.response?.status, url: String(p.response?.url ?? '') })
  })
  const t0 = Date.now()
  await page.goto(`${BASE}/`, { timeoutMs: 60000 }).catch(() => {})
  await delay(5000)
  const scripts = resources.filter((r) => r.type === 'Script' || /\.m?js(\?|$)/.test(r.url))
  const failedJS = scripts.filter((s) => s.status >= 400)
  const title = await page.title()
  const consoleErrors = page.consoleErrors.length
  step(
    'accueil',
    title && failedJS.length === 0 && consoleErrors === 0 ? 'pass' : 'fail',
    `HTTP doc ok, JS ${scripts.length - failedJS.length}/${scripts.length}, console=${consoleErrors}, ${Date.now() - t0} ms`,
    { title },
  )
  await page.close().catch(() => {})
}

// --- 2. Routes profondes annoncées sur l'accueil -----------------------------
for (const [route, label] of [['/quote/new', 'Publier une demande'], ['/how-it-works', 'Comment ça marche ?']]) {
  await delay(PACE_MS)
  const { page } = await newPage()
  await page.goto(`${BASE}/`, { timeoutMs: 60000 }).catch(() => {})
  await delay(3500)
  await page.goto(`${BASE}${route}`, { timeoutMs: 40000 }).catch(() => {})
  await delay(3500)
  const url = await page.url()
  const nomatch = page.consoleErrors.some((e) => /NG04002|noMatchError/i.test(e))
  const reached = url === `${BASE}${route}` || url === `${BASE}${route}/`
  step(
    `route profonde ${route} (${label})`,
    reached ? 'pass' : 'fail',
    reached ? `atteinte (${url})` : `NON atteinte → ${url}${nomatch ? ' ; NG04002 noMatchError' : ''}`,
    { url, nomatch },
  )
  await page.close().catch(() => {})
}

// --- 3. Accès direct à /auth/login -------------------------------------------
await delay(PACE_MS)
{
  const { page } = await newPage()
  const t0 = Date.now()
  let err = null
  try {
    await page.goto(`${BASE}/auth/login`, { timeoutMs: 45000 })
  } catch (e) {
    err = e.message
  }
  await delay(1500)
  const statuses = await page.evaluate('performance.getEntriesByType("navigation")[0]?.responseStatus ?? 0').catch(() => 0)
  step(
    'accès direct /auth/login',
    err ? 'fail' : 'pass',
    err ? `${err} (${Date.now() - t0} ms${statuses ? `, HTTP ${statuses}` : ''})` : `chargé (${await page.url()})`,
    { err, statuses },
  )
  await page.close().catch(() => {})
}

// --- 4. Connexion via navigation interne + soumission ------------------------
await delay(PACE_MS)
{
  const { page } = await newPage()
  await page.goto(`${BASE}/`, { timeoutMs: 60000 }).catch(() => {})
  await delay(4000)
  const clicked = await page.callFunction(() => {
    const b = [...document.querySelectorAll('button,a')].find((x) => /connexion/i.test(x.innerText || ''))
    if (b) b.click()
    return !!b
  })
  await delay(3500)
  const url = await page.url()
  const fields = await count(page, 'input')
  if (!clicked || fields < 2) {
    step('connexion (navigation interne)', 'fail', `bouton=${clicked} champs=${fields} url=${url}`)
  } else {
    await page.callFunction(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^se connecter$/i.test(x.innerText.trim()))
      if (b) b.click()
      return !!b
    })
    await delay(3000)
    const feedback = await page.callFunction(() =>
      [...document.querySelectorAll('small,[role=alert],[aria-invalid=true],[class*=error]')]
        .map((e) => e.innerText?.trim())
        .filter((t) => t && t.length < 90)
        .slice(0, 5),
    )
    step(
      'connexion (navigation interne) + soumission à vide',
      url.includes('/auth/login') ? 'pass' : 'fail',
      `url=${url}, champs=${fields}, retour=${feedback.length ? feedback.join(' | ') : '(aucun message de validation)'}`,
      { feedback },
    )
  }
  await page.close().catch(() => {})
}

// --- 5. Recherche ------------------------------------------------------------
await delay(PACE_MS)
{
  const { page, api } = await newPage()
  await page.goto(`${BASE}/`, { timeoutMs: 60000 }).catch(() => {})
  await delay(4000)
  await page.callFunction(() => {
    const input = document.querySelector('input[placeholder="Rechercher des produits, fournisseurs..."]')
    if (!input) return false
    input.focus()
    input.value = 'Riz'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
    return true
  })
  // La recherche n'est valide que si l'URL bascule vers les résultats.
  let url = await page.url()
  for (let i = 0; i < 20 && url.replace(/\/$/, '') === BASE; i += 1) {
    await delay(500)
    url = await page.url()
  }
  await delay(5000)
  const cards = await count(page, 'a[href^="/product/"]')
  const transmitted = /search=|products/.test(url)
  const status = has429(api) ? 'blocked' : transmitted && cards > 0 ? 'pass' : 'fail'
  step(
    `recherche « Riz »`,
    status,
    `url=${url}, produits=${cards}, requête transmise=${transmitted}` +
      (has429(api) ? ' ; API 429 (rate-limit)' : transmitted && cards === 0 ? ' ; 0 résultat pour « Riz »' : ''),
    { api },
  )
  await page.close().catch(() => {})
}

// --- 6. Listings -------------------------------------------------------------
for (const [route, sel] of [['/products', 'a[href^="/product/"]'], ['/sellers', 'a[href^="/sellers/"]'], ['/artisans', 'a[href^="/artisans/"]'], ['/annonces', 'a[href^="/annonces/"]']]) {
  await delay(PACE_MS)
  const { page, api } = await newPage()
  await page.goto(`${BASE}${route}`, { timeoutMs: 60000 }).catch(() => {})
  // Les listes se chargent parfois après le premier écran : on attend et on
  // défile pour déclencher un éventuel chargement paresseux (jusqu'à ~20 s).
  let n = 0
  for (let i = 0; i < 14; i += 1) {
    await delay(1500)
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {})
    n = await count(page, sel)
    if (n > 0) break
  }
  const sample = await page.callFunction(() => ({
    zero: /0 (produits?|vendeurs?|artisans?|annonces?)/i.test(document.body.innerText),
    anchors: [...new Set(Array.from(document.querySelectorAll('a[href^="/"]')).map((a) => a.getAttribute('href').split('?')[0]))].slice(0, 20),
    text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 220),
  }))
  const status = has429(api) ? 'blocked' : n > 0 ? 'pass' : 'fail'
  step(
    `listing ${route}`,
    status,
    `éléments « ${sel} » = ${n}${sample.zero ? ', « 0 » affiché' : ''}${has429(api) ? ' ; API 429' : ''}`,
    { api, ...sample },
  )
  await page.close().catch(() => {})
}

// --- 7. Page produit ---------------------------------------------------------
await delay(PACE_MS)
{
  const { page } = await newPage()
  await page.goto(`${BASE}/product/35634176-4386-440f-9708-af9bfd1caac7`, { timeoutMs: 60000 }).catch(() => {})
  await delay(6000)
  const h1 = await text(page, 'h1')
  const errs = page.consoleErrors.length
  const ng = page.consoleErrors.filter((e) => /NG\d{4}|TypeError/.test(e)).length
  step('page produit', h1 ? 'pass' : 'fail', `h1="${h1}", erreurs console=${errs} (dont ${ng} erreur(s) Angular/TypeError)`, { errors: page.consoleErrors.slice(0, 5) })
  await page.close().catch(() => {})
}

// --- 8. Panier ---------------------------------------------------------------
await delay(PACE_MS)
{
  const { page } = await newPage()
  await page.goto(`${BASE}/cart`, { timeoutMs: 60000 }).catch(() => {})
  await delay(4500)
  const t = await page.callFunction(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 120))
  step('panier', /panier/i.test(t) ? 'pass' : 'fail', t, null)
  await page.close().catch(() => {})
}

await browser.close().catch(() => {})

const summary = {
  base: BASE,
  date: new Date().toISOString(),
  pass: results.filter((r) => r.status === 'pass').length,
  fail: results.filter((r) => r.status === 'fail').length,
  blocked: results.filter((r) => r.status === 'blocked').length,
  results,
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`)
const md = [
  `# Audit ${BASE}`,
  '',
  `- ✓ pass : ${summary.pass}`,
  `- ✗ fail : ${summary.fail}`,
  `- • blocked (rate-limit) : ${summary.blocked}`,
  '',
  ...results.map((r) => `- ${r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '•'} **${r.name}** — ${r.detail}`),
  '',
]
writeFileSync(join(OUT, 'report.md'), md.join('\n'))

console.log('')
console.log(`AUDIT ${BASE} : ${summary.pass} pass, ${summary.fail} fail, ${summary.blocked} blocked → ${OUT}/report.md`)
process.exit(0)
