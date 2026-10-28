/**
 * Exécuteur de scénarios Playwright pour les cas QA classiques.
 *
 * Certains sites n’exposent pas d’outils WebMCP (odjafrik.com par exemple).
 * Un cas peut alors déclarer une suite d’actions Playwright déterministes :
 * `goto`, `fill`, `press`, `click`, `waitForText`… Le runner garde les
 * assertions finales (texte, URL, textes interdits) et enregistre la vidéo.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

function messageOf(error) {
  return error instanceof Error ? error.message : String(error ?? 'erreur inconnue')
}

function safeName(value) {
  return String(value || 'cas').replace(/[^A-Za-z0-9._-]+/g, '-')
}

function locatorFor(page, step) {
  if (step.selector) return page.locator(step.selector).first()
  if (step.placeholder) return page.getByPlaceholder(step.placeholder).first()
  if (step.label) return page.getByLabel(step.label).first()
  if (step.text) return page.getByText(step.text, { exact: step.exact === true }).first()
  if (step.role) {
    return page.getByRole(step.role, step.name ? { name: step.name } : {}).first()
  }
  throw new Error(`Sélecteur manquant pour l’action « ${step.action} »`)
}

async function perform(page, step, timeout) {
  const action = String(step.action ?? '').trim()
  switch (action) {
    case 'goto':
      return page.goto(step.url, { waitUntil: 'domcontentloaded', timeout })
    case 'fill':
      return locatorFor(page, step).fill(String(step.value ?? ''), { timeout })
    case 'press':
      return locatorFor(page, step).press(step.key || 'Enter', { timeout })
    case 'click':
      return locatorFor(page, step).click({ timeout })
    case 'waitForText':
      return page
        .getByText(step.text, { exact: step.exact === true })
        .first()
        .waitFor({ state: 'visible', timeout: Number(step.timeoutMs ?? timeout) })
    case 'waitForSelector':
      return page
        .locator(step.selector)
        .first()
        .waitFor({ state: 'visible', timeout: Number(step.timeoutMs ?? timeout) })
    case 'waitForUrl': {
      const pattern = new RegExp(step.pattern, 'i')
      return page.waitForURL((url) => pattern.test(url.toString()), {
        timeout: Number(step.timeoutMs ?? timeout),
      })
    }
    case 'expectUrl': {
      const pattern = new RegExp(step.pattern, 'i')
      if (!pattern.test(page.url())) {
        throw new Error(`URL ${page.url()} ne correspond pas à ${step.pattern}`)
      }
      return undefined
    }
    case 'wait':
      return page.waitForTimeout(Number(step.ms ?? 500))
    default:
      throw new Error(`Action Playwright inconnue : « ${action} »`)
  }
}

export async function runPlaywrightScenario(probe, options) {
  const started = performance.now()
  const {
    url,
    steps = [],
    storageState = null,
    timeoutMs = 30000,
    waitMs = 1200,
    videoDir = null,
    videoName = null,
    videoTailMs = 1000,
  } = options || {}

  if (!probe?.available) {
    return {
      ok: false,
      available: false,
      error: probe?.reason ?? 'sonde indisponible',
      durationMs: Math.round(performance.now() - started),
      steps: [],
    }
  }
  if (!url) {
    return { ok: false, available: true, error: 'URL manquante', steps: [] }
  }
  if (!steps.length) {
    return { ok: false, available: true, error: 'Aucune action Playwright', steps: [] }
  }
  if (storageState && !existsSync(storageState)) {
    return {
      ok: false,
      available: true,
      error: `storageState introuvable : ${storageState}`,
      steps: [],
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
  const log = []
  let failure = null
  let text = ''
  let finalUrl = ''

  try {
    const deadline = Date.now() + Number(timeoutMs) * Math.max(steps.length, 1)
    for (const [index, step] of steps.entries()) {
      const stepStarted = performance.now()
      const entry = {
        n: index + 1,
        action: step.action ?? '',
        target: step.selector || step.placeholder || step.label || step.text || step.url || step.pattern || '',
        ok: true,
        ms: 0,
      }
      try {
        if (Date.now() > deadline) throw new Error('délai global du scénario dépassé')
        await perform(page, step, Number(step.timeoutMs ?? Math.min(timeoutMs, 20000)))
        entry.ms = Math.round(performance.now() - stepStarted)
      } catch (error) {
        entry.ok = false
        entry.ms = Math.round(performance.now() - stepStarted)
        entry.error = messageOf(error).slice(0, 500)
        log.push(entry)
        failure = `Étape ${index + 1} (${step.action}) : ${entry.error}`
        break
      }
      log.push(entry)
    }

    if (!failure && waitMs > 0) await page.waitForTimeout(waitMs)

    finalUrl = page.url()
    try {
      text = await page.locator('body').innerText({ timeout: 5000 })
    } catch {
      text = ''
    }

    if (recording && videoTailMs > 0) await page.waitForTimeout(videoTailMs)
  } catch (error) {
    failure = failure || messageOf(error)
    finalUrl = page.url()
  }

  await context.close().catch(() => {})

  let videoPath = null
  if (video) {
    const target = join(videoDir || '', safeName(videoName || `playwright-${Date.now()}.webm`))
    try {
      await video.saveAs(target.endsWith('.webm') ? target : `${target}.webm`)
      videoPath = target.endsWith('.webm') ? target : `${target}.webm`
    } catch {
      // La vidéo est une preuve complémentaire, pas un critère de verdict.
    }
  }

  return {
    ok: !failure,
    available: true,
    url: finalUrl,
    text,
    steps: log,
    error: failure,
    durationMs: Math.round(performance.now() - started),
    video: videoPath,
  }
}
