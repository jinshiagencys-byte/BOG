/**
 * Exécuteur WebMCP pour les cas QA instrumentés.
 *
 * Un cas peut déclarer un outil exposé par la page (`webmcp.tool`) au lieu de
 * laisser fastbrowse deviner le parcours. L’outil est exécuté dans un vrai
 * Chrome, avec la même sonde Playwright que `page-probe.mjs`. Le runner vérifie
 * ensuite le résultat avec ses propres expressions régulières : le verdict ne
 * dépend jamais de la réponse d’un modèle.
 *
 * Vidéo : si `videoDir` est fourni, Playwright enregistre la session du cas et
 * l’enregistrement est déplacé vers `<videoDir>/<videoName>`.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

function messageOf(error) {
  return error instanceof Error ? error.message : String(error ?? 'erreur inconnue')
}

function asText(value) {
  if (value == null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function safeName(value) {
  return String(value || 'cas').replace(/[^A-Za-z0-9._-]+/g, '-')
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
    videoDir = null,
    videoName = null,
    videoTailMs = 700,
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

  const recording = Boolean(videoDir)
  if (recording) mkdirSync(videoDir, { recursive: true })

  const context = await probe.browser.newContext({
    locale: 'fr-FR',
    viewport: { width: 1280, height: 720 },
    ...(recording
      ? { recordVideo: { dir: join(videoDir, '.tmp'), size: { width: 1280, height: 720 } } }
      : {}),
    ...(storageState ? { storageState } : {}),
  })
  const page = await context.newPage()
  const video = page.video()
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

  let outcome
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
      outcome = {
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
    } else {
      const execution = await page.evaluate(
        async ({ name, input }) => {
          const rows = await document.modelContext.getTools()
          const found = rows.find((row) => row.name === name)
          if (!found) return { ok: false, error: 'tool-not-found' }
          // Chrome 154 attend une chaîne JSON ; Chrome 155+ accepte aussi
          // l’objet. La chaîne est donc le premier essai, l’objet le repli.
          try {
            return {
              ok: true,
              result: await document.modelContext.executeTool(found, JSON.stringify(input)),
            }
          } catch (first) {
            try {
              return { ok: true, result: await document.modelContext.executeTool(found, input) }
            } catch (second) {
              // `messageOf` vit côté Node : sérialiser ici, dans la page.
              const describe = (error) => String(error?.message ?? error)
              return {
                ok: false,
                error: describe(second),
                firstError: describe(first),
              }
            }
          }
        },
        { name: tool, input: args },
      )

      outcome = {
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
    }

    // Laisse le temps de voir le résultat à l’écran avant d’arrêter la vidéo.
    if (recording && videoTailMs > 0) await page.waitForTimeout(videoTailMs)
  } catch (error) {
    outcome = {
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
  }

  await context.close().catch(() => {})

  let videoPath = null
  if (video) {
    const target = join(videoDir || '', safeName(videoName || `webmcp-${tool}.webm`))
    if (!target.endsWith('.webm')) target += '.webm'
    try {
      await video.saveAs(target)
      videoPath = target
    } catch {
      // L’enregistrement est une preuve complémentaire, pas un critère de verdict.
    }
  }

  return {
    ...outcome,
    durationMs: outcome?.durationMs ?? Math.round(performance.now() - started),
    video: videoPath,
  }
}
