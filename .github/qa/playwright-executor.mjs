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

async function scrollThrough(page, { steps = 8, pauseMs = 250, selector = null } = {}) {
  const total = Math.max(1, Math.min(40, Number(steps)))
  const pause = Math.max(0, Math.min(2000, Number(pauseMs)))
  if (selector) {
    const locator = page.locator(selector).first()
    const count = await locator.count().catch(() => 0)
    if (count) {
      await locator.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {})
      if (pause) await page.waitForTimeout(pause)
      return
    }
  }
  // Défilement progressif : les listes en chargement différé ne rendent leurs
  // cartes qu’au fur et à mesure. On mesure la hauteur à chaque tour.
  let previous = -1
  for (let index = 0; index < total; index += 1) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0)
    const viewport = await page.evaluate(() => window.innerHeight).catch(() => 720)
    await page.evaluate(({ y }) => window.scrollTo(0, y), {
      y: Math.min(height, (index + 1) * viewport * 0.85),
    }).catch(() => {})
    if (pause) await page.waitForTimeout(pause)
    if (height === previous && index > 1) break
    previous = height
  }
  // On revient en haut pour que la vidéo montre le début de la page.
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
}

async function perform(page, step, timeout, collected) {
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
    case 'waitForText': {
      const locator = page.getByText(step.text, { exact: step.exact === true }).first()
      await locator.scrollIntoViewIfNeeded({ timeout: Number(step.timeoutMs ?? timeout) }).catch(() => {})
      return locator.waitFor({ state: 'visible', timeout: Number(step.timeoutMs ?? timeout) })
    }
    case 'waitForSelector': {
      const locator = page.locator(step.selector).first()
      await locator.scrollIntoViewIfNeeded({ timeout: Number(step.timeoutMs ?? timeout) }).catch(() => {})
      return locator.waitFor({ state: 'visible', timeout: Number(step.timeoutMs ?? timeout) })
    }
    case 'scroll':
      if (step.to === 'bottom') {
        return page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      }
      if (step.to === 'top') {
        return page.evaluate(() => window.scrollTo(0, 0))
      }
      if (step.to === 'selector' || step.selector) {
        return page.locator(step.selector).first().scrollIntoViewIfNeeded({ timeout })
      }
      return page.evaluate(({ by }) => window.scrollBy(0, by), {
        by: Number(step.by ?? 600),
      })
    case 'scrollThrough':
      return scrollThrough(page, step)
    case 'waitForUrl': {
      const pattern = new RegExp(step.pattern, 'i')
      // La navigation peut se terminer entre la validation du formulaire et
      // l’enregistrement de l’attente : on vérifie l’URL courante en boucle
      // plutôt que de dépendre d’un événement de navigation déjà passé.
      const deadline = Date.now() + Number(step.timeoutMs ?? timeout)
      while (Date.now() < deadline) {
        if (pattern.test(page.url())) return undefined
        await page.waitForTimeout(150)
      }
      throw new Error(`URL ${page.url()} ne correspond pas à ${step.pattern}`)
    }
    case 'expectUrl': {
      const pattern = new RegExp(step.pattern, 'i')
      if (!pattern.test(page.url())) {
        throw new Error(`URL ${page.url()} ne correspond pas à ${step.pattern}`)
      }
      return undefined
    }
    case 'selectOption': {
      const locator = step.selector ? page.locator(step.selector).first() : locatorFor(page, step)
      return locator.selectOption(step.label ? { label: step.label } : String(step.value ?? ''), {
        timeout,
      })
    }
    case 'evaluate': {
      const value = await page.evaluate(String(step.expression ?? 'null'))
      const name = step.as || 'value'
      collected[name] = value
      return undefined
    }
    case 'wait':
      return page.waitForTimeout(Number(step.ms ?? 500))
    default:
      throw new Error(`Action Playwright inconnue : « ${action} »`)
  }
}

async function checkVisibleTexts(page, patterns) {
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 }
  const checks = []
  for (const pattern of patterns) {
    const locator = page.getByText(new RegExp(pattern, 'i')).first()
    let found = 0
    try {
      found = await locator.count()
    } catch {
      found = 0
    }
    let visible = false
    let inViewport = false
    let scrolled = false
    let kind = 'element'
    if (found) {
      kind = await locator
        .evaluate((node) => (node.tagName?.toLowerCase() === 'option' ? 'option' : 'element'))
        .catch(() => 'element')
      if (kind === 'option') {
        // Une <option> n’est jamais « visible » au sens CSS : c’est le select
        // qui l’est. On vérifie donc le contrôle qui la contient.
        visible = await locator
          .evaluate((node) => {
            const select = node.closest('select')
            if (!select) return false
            const rect = select.getBoundingClientRect()
            const style = getComputedStyle(select)
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.visibility !== 'hidden' &&
              style.display !== 'none'
            )
          })
          .catch(() => false)
        inViewport = visible
      } else {
        const before = await locator.boundingBox().catch(() => null)
        scrolled = before ? before.y < 0 || before.y > viewport.height - 20 : false
        await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
        visible = await locator.isVisible().catch(() => false)
        const box = await locator.boundingBox().catch(() => null)
        if (box) {
          inViewport =
            box.y + Math.min(box.height, 4) >= 0 &&
            box.y <= viewport.height &&
            box.x < viewport.width &&
            box.x + Math.min(box.width, 4) >= 0
        }
      }
    }
    checks.push({ pattern, found, visible, inViewport, scrolled, kind })
  }
  return checks
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
    expect: expectations = {},
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
  const httpErrors = []
  const collected = {}
  let failure = null
  let text = ''
  let finalUrl = ''
  let visibleChecks = []

  // Un 429 n'est pas un bug du site : c'est le quota de l'API. On le remonte
  // pour que le verdict soit `blocked`, pas `failed`.
  page.on('response', (response) => {
    if (response.status() < 400) return
    if (httpErrors.length >= 30) return
    httpErrors.push({ status: response.status(), url: response.url().slice(0, 300) })
  })

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
        await perform(page, step, Number(step.timeoutMs ?? Math.min(timeoutMs, 20000)), collected)
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

    // Vérifier chaque texte attendu en le faisant défiler jusqu’à l’écran :
    // un texte présent dans le DOM mais jamais visible ne compte pas.
    visibleChecks = failure ? [] : await checkVisibleTexts(page, expectations.text ?? [])

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
    httpErrors,
    error: failure,
    collected,
    visibleChecks,
    durationMs: Math.round(performance.now() - started),
    video: videoPath,
  }
}
