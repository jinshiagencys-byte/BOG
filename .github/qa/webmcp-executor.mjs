/**
 * Exécuteur WebMCP pour les cas QA instrumentés.
 *
 * Un cas peut déclarer un outil exposé par la page (`webmcp.tool`) au lieu de
 * laisser fastbrowse deviner le parcours. L’outil est exécuté dans un vrai
 * Chrome, avec la même sonde Playwright que `page-probe.mjs`. Le runner vérifie
 * ensuite le résultat avec ses propres expressions régulières : le verdict ne
 * dépend jamais de la réponse d’un modèle.
 */
import { existsSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

function messageOf(error) {
  return error instanceof Error ? error.message : String(error ?? 'erreur inconnue')
}

function asText(value) {
  if (value == null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export async function runWebMcpTool(probe, options) {
  const started = performance.now()
  const {
    url,
    tool,
    args = {},
    storageState = null,
    confirm = false,
    timeoutMs = 15000,
    waitMs = 1200,
  } = options || {}

  if (!probe?.available) {
    return {
      ok: false,
      available: false,
      error: probe?.reason ?? 'sonde indisponible',
      durationMs: Math.round(performance.now() - started),
    }
  }
  if (!url) {
    return { ok: false, available: true, error: 'URL manquante', durationMs: 0 }
  }
  if (!tool) {
    return { ok: false, available: true, error: 'Outil WebMCP manquant', durationMs: 0 }
  }
  if (storageState && !existsSync(storageState)) {
    return {
      ok: false,
      available: true,
      error: `storageState introuvable : ${storageState}`,
      durationMs: Math.round(performance.now() - started),
    }
  }

  const context = await probe.browser.newContext({
    locale: 'fr-FR',
    viewport: { width: 1440, height: 900 },
    ...(storageState ? { storageState } : {}),
  })
  const page = await context.newPage()
  let dialog = null

  // Un outil consequential peut ouvrir une confirmation. En QA, elle n’est
  // acceptée que si le cas le demande explicitement (`confirm: true`) ;
  // sinon on refuse, comme le ferait un utilisateur prudent.
  page.on('dialog', async (current) => {
    dialog = { type: current.type(), message: current.message() }
    try {
      if (confirm) await current.accept()
      else await current.dismiss()
    } catch {
      // La page a pu se fermer entre-temps.
    }
  })

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    if (waitMs > 0) await page.waitForTimeout(waitMs)

    const deadline = Date.now() + timeoutMs
    let tools = []
    while (Date.now() < deadline) {
      tools = await page
        .evaluate(async () => {
          if (!document.modelContext || typeof document.modelContext.getTools !== 'function') return []
          try {
            const rows = await document.modelContext.getTools()
            return rows.map((row) => row.name)
          } catch {
            return []
          }
        })
        .catch(() => [])
      if (tools.includes(tool)) break
      await page.waitForTimeout(250)
    }

    if (!tools.includes(tool)) {
      return {
        ok: false,
        available: true,
        tool,
        args,
        tools,
        dialog,
        error: `Outil WebMCP introuvable : ${tool}`,
        durationMs: Math.round(performance.now() - started),
        url: page.url(),
      }
    }

    const execution = await page.evaluate(
      async ({ name, input }) => {
        const rows = await document.modelContext.getTools()
        const found = rows.find((row) => row.name === name)
        if (!found) return { ok: false, error: 'tool-not-found' }
        // Chrome 155+ accepte l’objet ; 154 attend encore une chaîne JSON.
        try {
          return { ok: true, result: await document.modelContext.executeTool(found, input) }
        } catch (first) {
          try {
            return {
              ok: true,
              result: await document.modelContext.executeTool(found, JSON.stringify(input)),
            }
          } catch (second) {
            return {
              ok: false,
              error: messageOf(second),
              firstError: messageOf(first),
            }
          }
        }
      },
      { name: tool, input: args },
    )

    return {
      ok: execution.ok === true,
      available: true,
      tool,
      args,
      result: execution.result ?? null,
      text: asText(execution.result),
      tools,
      dialog,
      error: execution.ok ? null : execution.error ?? 'échec de l’outil',
      durationMs: Math.round(performance.now() - started),
      url: page.url(),
    }
  } catch (error) {
    return {
      ok: false,
      available: true,
      tool,
      args,
      tools: [],
      dialog,
      error: messageOf(error),
      durationMs: Math.round(performance.now() - started),
      url: page.url(),
    }
  } finally {
    await context.close().catch(() => {})
  }
}
