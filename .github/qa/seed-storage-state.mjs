#!/usr/bin/env node
/**
 * Pré-charge une session authentifiée dans le Chrome du run QA (surface Chrome
 * DevTools MCP).
 *
 * Le serveur MCP WebMCP appliquait autrefois le `storageState` de Playwright pour
 * l'agent. Depuis la bascule vers Chrome DevTools MCP, l'état est injecté
 * directement dans le Chrome partagé, sans serveur MCP intermédiaire :
 *   - les cookies via `Network.setCookies` (portée navigateur : tous les onglets
 *     ouverts ensuite par l'agent en héritent) ;
 *   - le `localStorage` de chaque origine en s'y rendant puis en écrivant les clés,
 *     pour que Chrome les persiste dans le profil (`--user-data-dir`).
 *
 * Aucun secret n'est journalisé. Sans URL CDP ou sans état, le script ne fait rien
 * et sort en 0 : ce n'est pas une condition d'échec.
 *
 * Variables : `WEBMCP_CDP_URL` (ou `CDP_URL`), `WEBMCP_STORAGE_STATE` (ou
 * `STORAGE_STATE`).
 */

import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { connectBrowser } from './cdp-client.mjs'

const CDP_URL = process.env.WEBMCP_CDP_URL || process.env.CDP_URL || ''
const STATE_PATH = process.env.WEBMCP_STORAGE_STATE || process.env.STORAGE_STATE || ''

if (!CDP_URL || !STATE_PATH) {
  console.log('seed-storage-state : URL CDP ou état de session absent, rien à faire.')
  process.exit(0)
}

let state
try {
  state = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
} catch (error) {
  console.error(`seed-storage-state : état illisible (${error.message}) — session publique seulement.`)
  process.exit(0)
}

const cookies = Array.isArray(state?.cookies) ? state.cookies : []
const origins = Array.isArray(state?.origins) ? state.origins : []

const browser = await connectBrowser(CDP_URL)
const page = await browser.newPage()
try {
  await page.applyStorageState(state)
  for (const origin of origins) {
    const url = origin?.origin
    if (!url) continue
    await page.goto(url, { timeoutMs: 30000 }).catch(() => {})
    // Laisse Chrome écrire le localStorage dans le profil avant de continuer.
    await delay(800)
  }
} finally {
  // En mode partagé, `close()` ne ferme que notre connexion, pas le Chrome du run.
  await page.close().catch(() => {})
  await browser.close().catch(() => {})
}

console.log(`seed-storage-state : ${cookies.length} cookie(s), ${origins.length} origine(s) appliqués.`)
process.exit(0)
