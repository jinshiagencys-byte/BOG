/**
 * Explorateur de site — construit un profil factuel, sans LLM.
 *
 * Une exploration par site, renouvelée chaque semaine : le profil sert ensuite
 * à rendre les cas concrets (vrais produits, vrais prix, vrais libellés) et à
 * générer des scénarios qui vérifient le comportement, pas seulement la présence.
 *
 * Chaque fait porte sa preuve (`evidence`) : URL, sélecteur et valeur observée.
 * Aucune valeur n'est inventée : si le site ne l'expose pas, le champ est nul.
 */

const CURRENCY = '(FCFA|XOF|CFA|EUR|€|USD|\\$|MAD|GNF|NGN|₦)'

function clean(value, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

/**
 * Isole le prix dans un texte. Le dernier groupe numérique avant la devise
 * gagne : « 16 avis · 1 875 000 FCFA » ne doit pas devenir 161875000.
 */
export function priceFrom(text, { last = false } = {}) {
  const re = new RegExp(`(?:^|[^\\p{L}\\d])(\\d[\\d\\s.,]{0,18}?)\\s*${CURRENCY}`, 'giu')
  const matches = [...String(text ?? '').matchAll(re)]
  const match = last ? matches[matches.length - 1] : matches[0]
  if (!match) return ''
  const chunks = match[1].trim().split(/\s+/)
  const tail = [chunks[chunks.length - 1]]
  if (!/[,.]/.test(tail[0])) {
    for (let i = chunks.length - 2; i >= 0 && tail.length < 4; i -= 1) {
      if (!/^\d{1,3}$/.test(chunks[i]) || !/^\d{1,3}$/.test(tail[0])) break
      tail.unshift(chunks[i])
    }
  }
  return `${tail.join(' ')} ${match[2]}`.replace(/\s+/g, ' ').trim()
}

/** « 1 875 000 FCFA », « 15,000 », « 12.50 € » → nombre. */
export function parsePrice(text) {
  const match = String(priceFrom(text) ?? '').match(/^([\d\s.,]+)/)
  if (!match) return null
  const raw = match[1].replace(/\s/g, '')
  const hasComma = raw.includes(',')
  const hasDot = raw.includes('.')
  let normalised = raw
  if (hasComma && hasDot) {
    // 1.875.000,50 ou 1,875,000.50 : le dernier séparateur est décimal.
    normalised = raw.lastIndexOf(',') > raw.lastIndexOf('.')
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '')
  } else if (hasComma) {
    normalised = /,\d{2}$/.test(raw) && !/,\d{3}(?:,|$)/.test(raw)
      ? raw.replace(',', '.')
      : raw.replace(/,/g, '')
  } else if (hasDot) {
    normalised = /\.\d{3}(?:\.|$)/.test(raw) ? raw.replace(/\./g, '') : raw
  }
  const number = Number(normalised)
  return Number.isFinite(number) ? number : null
}

async function settle(page, ms) {
  await page.waitForTimeout(ms)
  try {
    await page.waitForLoadState('networkidle', { timeout: 4000 })
  } catch {
    // Les sites qui gardent une connexion ouverte ne sont jamais « idle ».
  }
}

/** Lecture générique d'une page : navigation, recherche, cartes, contrôles. */
async function readPage(page) {
  return page.evaluate(() => {
    const text = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim()
    const absolute = (href) => {
      try {
        return new URL(href, location.href).toString()
      } catch {
        return null
      }
    }
    const isProduct = (href) => /(\/(product|products|produit|produits|article|articles|item)\/[^/?#]+|\/p\/[A-Za-z0-9-]{4,})/.test(href)
    const isSeller = (href) => /\/(sellers?|vendeurs?|artisans?|boutiques?)\/[^/?#]+/i.test(href)
    const priceRe = /(?:^|[^\p{L}\d])(\d[\d\s.,]{0,18}?)\s*(FCFA|XOF|CFA|EUR|€|USD|\$|MAD|GNF|NGN|₦)/iu

    // « 16 16 1,875,000 FCFA » : on garde le dernier groupe numérique avant
    // la devise, sinon un compteur (16 avis) est collé au prix.
    const priceOf = (value) => {
      const re = new RegExp(priceRe.source, 'giu')
      let last = null
      for (const match of String(value ?? '').matchAll(re)) last = match
      if (!last) return ''
      const chunks = last[1].trim().split(/\s+/)
      const tail = [chunks[chunks.length - 1]]
      if (!/[,.]/.test(tail[0])) {
        for (let i = chunks.length - 2; i >= 0 && tail.length < 4; i -= 1) {
          if (!/^\d{1,3}$/.test(chunks[i]) || !/^\d{1,3}$/.test(tail[0])) break
          tail.unshift(chunks[i])
        }
      }
      return `${tail.join(' ')} ${last[2]}`.replace(/\s+/g, ' ').trim()
    }

    const nav = []
    const seenNav = new Set()
    for (const anchor of document.querySelectorAll('header a[href], nav a[href], [role="navigation"] a[href], footer a[href]')) {
      const href = absolute(anchor.getAttribute('href'))
      if (!href || !href.startsWith(location.origin)) continue
      const label = text(anchor) || anchor.getAttribute('aria-label') || ''
      if (!label) continue
      const key = `${label}|${href}`
      if (seenNav.has(key)) continue
      seenNav.add(key)
      nav.push({ label: label.slice(0, 60), href, path: new URL(href).pathname })
      if (nav.length >= 40) break
    }

    const cards = []
    const seenCards = new Set()
    for (const anchor of document.querySelectorAll('a[href]')) {
      const href = absolute(anchor.getAttribute('href'))
      if (!href || !isProduct(new URL(href).pathname)) continue
      if (seenCards.has(href)) continue
      let node = anchor
      let found = null
      for (let depth = 0; depth < 6 && node; depth += 1) {
        const body = text(node)
        if (body && body.length < 700 && priceRe.test(body)) {
          found = node
          break
        }
        node = node.parentElement
      }
      if (!found) continue
      seenCards.add(href)

      const body = text(found)
      const heading = found.querySelector('h1, h2, h3, h4')
      const priceText = priceOf(body)
      const sellerAnchor = [...found.querySelectorAll('a[href]')].find((a) =>
        isSeller(absolute(a.getAttribute('href')) || location.href),
      )
      cards.push({
        title: cleanTitle(heading ? text(heading) : text(anchor)),
        href,
        priceText,
        seller: sellerAnchor ? text(sellerAnchor) : '',
        sellerHref: sellerAnchor ? absolute(sellerAnchor.getAttribute('href')) : '',
      })
      if (cards.length >= 24) break
    }

    // Annuaire : les fiches vendeurs/artisans, hors liens de navigation.
    const sellerCards = []
    const seenSellers = new Set()
    for (const anchor of document.querySelectorAll('a[href]')) {
      const href = absolute(anchor.getAttribute('href'))
      if (!href || !isSeller(new URL(href).pathname)) continue
      if (seenSellers.has(href)) continue
      const label = text(anchor)
      if (!label || label.length > 90) continue
      seenSellers.add(href)
      sellerCards.push({ name: label, href })
      if (sellerCards.length >= 24) break
    }

    function cleanTitle(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 140)
    }

    const searchInputs = [...document.querySelectorAll('input')]
      .filter((input) => {
        const hint = `${input.placeholder || ''} ${input.getAttribute('aria-label') || ''} ${input.name || ''} ${input.id || ''}`
        return input.type !== 'hidden' && /recherch|search|chercher|produit|mot[- ]cl/i.test(hint)
      })
      .slice(0, 4)
      .map((input, index) => {
        const rect = input.getBoundingClientRect()
        const style = getComputedStyle(input)
        const visible =
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        if (visible) input.setAttribute('data-qa-search', String(index))
        return {
          placeholder: input.placeholder || '',
          label: input.getAttribute('aria-label') || '',
          name: input.name || '',
          id: input.id || '',
          type: input.type,
          visible,
          formAction: input.form ? absolute(input.form.getAttribute('action')) : null,
          formMethod: input.form ? (input.form.getAttribute('method') || 'get').toLowerCase() : null,
        }
      })

    const selects = [...document.querySelectorAll('select')]
      .map((select) => ({
        name: select.name || '',
        id: select.id || '',
        options: [...select.options].map((option) => text(option) || option.value).filter(Boolean).slice(0, 20),
      }))
      .filter((select) => select.options.length > 1)
      .slice(0, 6)

    const buttons = [...document.querySelectorAll('button, [role="button"], a.button')]
      .map((button) => text(button))
      .filter((label) => label && label.length <= 40)
      .slice(0, 60)

    const inputs = [...document.querySelectorAll('input, textarea')]
      .filter((input) => input.type !== 'hidden')
      .slice(0, 20)
      .map((input) => ({
        type: input.type || input.tagName.toLowerCase(),
        placeholder: input.placeholder || '',
        name: input.name || '',
        label: input.getAttribute('aria-label') || '',
        required: input.required === true,
      }))

    return {
      url: location.href,
      title: document.title,
      lang: document.documentElement.lang || '',
      heading: text(document.querySelector('h1')),
      nav,
      cards,
      sellerCards,
      searchInputs,
      selects,
      buttons,
      inputs,
      body: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 6000),
    }
  })
}

function pickTerms(profile) {
  const stop = new Set([
    'les', 'des', 'pour', 'avec', 'dans', 'sur', 'une', 'aux', 'par', 'plus',
    'produit', 'produits', 'article', 'articles', 'boutique', 'vendeur',
    'merveilles', 'nouveau', 'nouveautes', 'promo', 'vente', 'achat', 'long',
    'grain', 'piece', 'unite', 'stock',
  ])
  const terms = []
  for (const product of profile.products) {
    for (const word of String(product.title ?? '').split(/[^\p{L}\p{N}'-]+/u)) {
      const token = word.replace(/^['-]+|['-]+$/g, '')
      if (token.length < 5 || stop.has(token.toLowerCase())) continue
      if (terms.some((term) => term.toLowerCase() === token.toLowerCase())) continue
      terms.push(token)
      break
    }
    if (terms.length >= 3) break
  }
  return terms
}

function emptyStateFrom(text) {
  const lines = String(text ?? '')
    .split(/[.!?]\s|\s{2,}/)
    .map((line) => line.trim())
    .filter((line) => line.length > 3 && line.length < 140)
    .filter((line) => /aucun|aucune|no result|0 produit|rien (n’|n')?a|introuvable/i.test(line))
  return lines[0] ?? null
}

function mergeCards(profile, pageInfo, source) {
  for (const card of pageInfo.cards) {
    if (profile.products.some((product) => product.href === card.href)) continue
    const price = parsePrice(card.priceText)
    profile.products.push({
      title: card.title,
      href: card.href,
      price,
      priceText: clean(card.priceText, 40),
      seller: clean(card.seller, 80),
      sellerHref: card.sellerHref || null,
      source,
    })
    if (profile.products.length >= 12) break
  }
}

export async function exploreSite(probe, options = {}) {
  const started = Date.now()
  const budgetMs = Number(options.budgetMs ?? 150000)
  const settleMs = Number(options.settleMs ?? 2200)
  const maxPages = Number(options.maxPages ?? 10)
  const siteUrl = String(options.url ?? '').trim()

  const profile = {
    version: 1,
    captured_at: new Date().toISOString(),
    status: 'ready',
    site: { url: siteUrl, origin: '', title: '', heading: '', lang: '', currency: null },
    navigation: [],
    search: null,
    catalog: null,
    products: [],
    product: null,
    sellers: [],
    sellersPage: null,
    emptyState: null,
    forms: [],
    controls: { sort: [], filters: [], actions: [] },
    evidence: [],
    pages: [],
    issues: [],
  }

  if (!probe?.available) {
    return { ...profile, status: 'failed', issues: [probe?.reason ?? 'sonde indisponible'] }
  }
  if (!/^https?:\/\//i.test(siteUrl)) {
    return { ...profile, status: 'failed', issues: ['URL invalide'] }
  }

  const origin = new URL(siteUrl).origin
  profile.site.origin = origin

  const context = await probe.browser.newContext({
    locale: 'fr-FR',
    viewport: { width: 1280, height: 720 },
    ...(options.storageState ? { storageState: options.storageState } : {}),
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()
  const rateLimited = []
  page.on('response', (response) => {
    if (response.status() === 429 && rateLimited.length < 10) {
      rateLimited.push(response.url().slice(0, 200))
    }
  })

  async function visit(url, { settle: waitMs = settleMs } = {}) {
    if (Date.now() - started > budgetMs) throw new Error('budget d’exploration dépassé')
    if (profile.pages.length >= maxPages) throw new Error('nombre de pages explorées atteint')
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await settle(page, waitMs)
    const info = await readPage(page)
    profile.pages.push({ url: info.url, title: clean(info.title, 120), httpStatus: response?.status() ?? null })
    return info
  }

  function fact(key, value, source) {
    if (value === null || value === undefined || value === '') return
    profile.evidence.push({ key, value: clean(value, 160), url: source.url, selector: source.selector ?? '' })
  }

  try {
    // 1. Accueil
    const home = await visit(siteUrl)
    profile.site.title = clean(home.title, 120)
    profile.site.heading = clean(home.heading, 160)
    profile.site.lang = clean(home.lang, 8)
    profile.navigation = home.nav
    fact('site.title', profile.site.title, { url: home.url, selector: 'title' })
    fact('site.heading', profile.site.heading, { url: home.url, selector: 'h1' })
    mergeCards(profile, home, 'home')

    const inputs = home.searchInputs.find((input) => input.visible) ?? home.searchInputs[0] ?? null
    if (inputs) {
      profile.search = {
        placeholder: inputs.placeholder,
        label: inputs.label,
        name: inputs.name,
        id: inputs.id,
        formAction: inputs.formAction,
        queryParam: 'search',
        sampleTerm: null,
        emptyTerm: 'zzzzznope',
        emptyText: null,
        resultCountText: null,
      }
      fact('search.placeholder', inputs.placeholder || inputs.label, {
        url: home.url,
        selector: 'input',
      })
    }

    profile.forms = home.inputs.map((input) => ({
      type: input.type,
      placeholder: clean(input.placeholder, 80),
      name: input.name,
      label: clean(input.label, 80),
      required: input.required,
    }))
    profile.controls.actions = [...new Set(home.buttons)]
      .filter((label) => /ajouter|panier|acheter|commander|réserver|s’inscrire|inscrire|connexion|devis|contact/i.test(label))
      .slice(0, 12)

    // 2. Catalogue : lien de navigation, sinon chemins usuels. Certains sites
    //    renvoient « Produits » vers l’accueil : on vérifie avant de conclure.
    const catalogCandidates = []
    for (const item of home.nav) {
      if (!/produit|catalogue|boutique|shop|annonce|marketplace/i.test(item.label)) continue
      if (item.path === '/' || item.path === '') continue
      if (catalogCandidates.some((candidate) => candidate.url === item.href)) continue
      catalogCandidates.push({
        label: item.label,
        url: item.href,
        score: /produit|catalogue|boutique|shop|marketplace/i.test(item.label) ? 0 : 1,
      })
    }
    catalogCandidates.sort((a, b) => a.score - b.score)
    for (const path of ['/products', '/produits', '/catalogue', '/shop', '/annonces']) {
      if (catalogCandidates.some((candidate) => new URL(candidate.url).pathname === path)) continue
      catalogCandidates.push({ label: path, url: new URL(path, origin).toString() })
    }

    let catalog = null
    for (const candidate of catalogCandidates.slice(0, 2)) {
      try {
        const info = await visit(candidate.url)
        if (!info.cards.length) await settle(page, 2500)
        const refreshed = info.cards.length ? info : await readPage(page)
        const hasSort = refreshed.selects.some((select) =>
          select.options.some((option) => /prix|price|pertinence|nouveaut|note|popularit/i.test(option)),
        )
        if (refreshed.cards.length || hasSort) {
          catalog = { ...refreshed, label: candidate.label }
          break
        }
      } catch (error) {
        profile.issues.push(`Catalogue ${candidate.label} : ${clean(error?.message ?? error, 140)}`)
      }
    }

    if (catalog) {
      const sort = catalog.selects.find((select) =>
        select.options.some((option) => /prix|price|pertinence|nouveaut|note|popularit/i.test(option)),
      ) ?? null
      profile.catalog = {
        url: catalog.url,
        label: catalog.label,
        count: catalog.cards.length,
        sort: sort
          ? {
              name: sort.name,
              id: sort.id,
              options: sort.options,
              ascending: sort.options.find((option) => /croissant|asc|low/i.test(option)) ?? null,
              descending: sort.options.find((option) => /décroissant|decroissant|desc|high/i.test(option)) ?? null,
            }
          : null,
      }
      profile.controls.sort = sort?.options ?? []
      fact('catalog.url', catalog.url, { url: catalog.url })
      if (sort) fact('catalog.sort', sort.options.join(' | '), { url: catalog.url, selector: 'select' })
      mergeCards(profile, catalog, 'catalog')
      if (!catalog.cards.length) {
        profile.issues.push(`Catalogue sans produit visible : ${catalog.url}`)
      }
    } else {
      profile.issues.push('Aucun catalogue identifié sur le site')
    }

    // 3. Recherche avec un terme réel, puis sans résultat.
    if (profile.search) {
      const terms = pickTerms(profile)
      profile.search.attempts = []
      for (const term of terms.slice(0, 2)) {
        try {
          const searchPage = await visit(siteUrl)
          const field = searchPage.searchInputs.find((input) => input.visible) ?? searchPage.searchInputs[0]
          if (!field) break
          const locator = page.locator('[data-qa-search]').first()
          await locator.click({ timeout: 5000 }).catch(() => {})
          await locator.fill(term, { timeout: 8000 })
          await locator.press('Enter', { timeout: 8000 })
          await settle(page, 3000)
          const results = await readPage(page)
          profile.search.attempts.push({ term, url: results.url, cards: results.cards.length })
          profile.search.resultUrl = results.url
          profile.search.resultCountText =
            (results.body.match(/([\d\s.,]+)\s*(produits?|résultats?|results?)/i) || [])[0] ?? null
          if (results.cards.length) {
            profile.search.sampleTerm = term
            profile.search.hasResults = true
            profile.search.resultTitles = results.cards.map((card) => card.title).slice(0, 5)
            fact('search.sampleTerm', term, { url: results.url, selector: 'input' })
            if (profile.search.resultCountText) {
              fact('search.resultCount', profile.search.resultCountText, { url: results.url })
            }
            mergeCards(profile, results, 'search')
            break
          }
        } catch (error) {
          profile.search.attempts.push({ term, error: clean(error?.message ?? error, 140) })
        }
      }
      if (!profile.search.hasResults) {
        profile.search.sampleTerm = terms[0] ?? null
        profile.issues.push(
          `Aucun terme de recherche testé ne renvoie de produit (${terms.join(', ') || 'aucun terme'})`,
        )
      }

      try {
        await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await settle(page, 1200)
        const emptyPage = await readPage(page)
        const emptyField = emptyPage.searchInputs.find((input) => input.visible) ?? emptyPage.searchInputs[0]
        if (!emptyField) throw new Error('champ de recherche introuvable')
        const field = page.locator('[data-qa-search]').first()
        await field.click({ timeout: 5000 }).catch(() => {})
        await field.fill(profile.search.emptyTerm, { timeout: 8000 })
        await field.press('Enter', { timeout: 8000 })
        await settle(page, 3000)
        const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')
        profile.emptyState = emptyStateFrom(body)
        if (profile.emptyState) {
          fact('search.emptyState', profile.emptyState, { url: page.url() })
        }
      } catch (error) {
        profile.issues.push(`État vide : ${clean(error?.message ?? error, 160)}`)
      }
    }

    // 4. Fiche produit : la première réellement vue.
    const candidate = profile.products.find((product) => product.price != null) ?? profile.products[0]
    if (candidate) {
      try {
        const productPage = await visit(candidate.href)
        const body = productPage.body
        // Certaines fiches n'ont pas de <h1> : le titre de la carte reste la
        // meilleure preuve, à condition qu'il soit bien présent dans la page.
        const pageTitle = clean(productPage.heading, 160)
        const title = pageTitle || (normalize(body).includes(normalize(candidate.title)) ? candidate.title : '')
        const priceText = priceFrom(body) || candidate.priceText
        const availability =
          (body.match(/(en stock|disponible|rupture de stock|indisponible|out of stock)/i) || [])[0] ?? null
        const addToCart =
          productPage.buttons.find((label) => /ajouter au panier|ajouter|acheter|commander/i.test(label)) ?? null
        profile.product = {
          url: productPage.url,
          title: clean(title, 160),
          cardTitle: clean(candidate.title, 160),
          price: parsePrice(priceText),
          priceText: clean(priceText, 40),
          availability: availability ? clean(availability, 40) : null,
          addToCart,
          seller: null,
          sellerHref: null,
          titleMatchesCard:
            normalize(clean(title, 160)) === normalize(candidate.title),
        }
        fact('product.title', profile.product.title, { url: productPage.url, selector: 'h1' })
        fact('product.price', profile.product.priceText, { url: productPage.url })
        if (availability) fact('product.availability', availability, { url: productPage.url })
        if (addToCart) fact('product.addToCart', addToCart, { url: productPage.url, selector: 'button' })

        const sellerCard = productPage.sellerCards[0] ?? null
        if (sellerCard) {
          profile.product.seller = clean(sellerCard.name, 80)
          profile.product.sellerHref = sellerCard.href
          profile.product.sellerConfirmed = true
        } else if (candidate.seller) {
          // La fiche ne lie pas toujours le vendeur : on reprend celui annoncé
          // sur la carte, et on vérifie qu'il est bien affiché sur la fiche.
          profile.product.seller = candidate.seller
          profile.product.sellerHref = candidate.sellerHref || null
          profile.product.sellerConfirmed =
            normalize(body).includes(normalize(candidate.seller))
          if (!profile.product.sellerConfirmed) {
            profile.issues.push(`Vendeur « ${candidate.seller} » absent de la fiche produit`)
          }
        }
      } catch (error) {
        profile.issues.push(`Fiche produit : ${clean(error?.message ?? error, 160)}`)
      }
    }

    // 5. Vendeurs / artisans, si le site les expose.
    const sellersLink = profile.navigation.find((item) =>
      /vendeur|seller|artisan|boutique/i.test(item.label) || /\/(sellers?|vendeurs?|artisans?)\/?$/i.test(item.path),
    )
    if (sellersLink) {
      try {
        const sellersPage = await visit(new URL(sellersLink.path, origin).toString())
        const countText =
          (sellersPage.body.match(/([\d\s.,]+)\s*(vendeurs?|artisans?|boutiques?|résultats?)/i) || [])[0] ?? null
        profile.sellersPage = {
          url: sellersPage.url,
          heading: clean(sellersPage.heading, 160),
          countText: countText ? clean(countText, 80) : null,
          emptyText: emptyStateFrom(sellersPage.body),
        }
        const names = []
        const seen = new Set()
        for (const card of sellersPage.sellerCards) {
          const name = clean(card.name, 80)
          if (!name || /^(vendeurs?|artisans?|boutiques?|accueil|produits?)$/i.test(name)) continue
          if (seen.has(name)) continue
          seen.add(name)
          names.push(name)
          if (names.length >= 8) break
        }
        for (const card of sellersPage.cards) {
          if (!card.seller || seen.has(card.seller) || names.length >= 8) continue
          seen.add(card.seller)
          names.push(card.seller)
        }
        profile.sellers = names.slice(0, 8).map((name) => ({ name: clean(name, 80), sourceUrl: sellersPage.url }))
        if (!profile.sellers.length) {
          const seen = new Set()
          for (const product of profile.products) {
            if (!product.seller || seen.has(product.seller)) continue
            seen.add(product.seller)
            profile.sellers.push({ name: product.seller, sourceUrl: product.href })
          }
          if (profile.sellers.length) {
            profile.issues.push(
              `Annuaire vide (${sellersLink.label}) : vendeurs repris des fiches produit`,
            )
          } else {
            profile.issues.push(`Page « ${sellersLink.label} » sans nom de vendeur visible`)
          }
        }
        if (profile.sellers.length) {
          fact('sellers.first', profile.sellers[0].name, { url: sellersPage.url })
        }
      } catch (error) {
        profile.issues.push(`Vendeurs : ${clean(error?.message ?? error, 160)}`)
      }
    }

    // Devise dominante des prix observés.
    const currencies = new Map()
    for (const product of profile.products) {
      const currency = String(product.priceText).trim().split(/\s+/).pop()
      if (!currency) continue
      currencies.set(currency.toUpperCase(), (currencies.get(currency.toUpperCase()) ?? 0) + 1)
    }
    profile.site.currency = [...currencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  } catch (error) {
    profile.issues.push(`Exploration interrompue : ${clean(error?.message ?? error, 200)}`)
  } finally {
    await context.close().catch(() => {})
  }

  if (rateLimited.length) {
    profile.status = 'partial'
    profile.issues.push(`Quota 429 sur ${rateLimited.length} requête(s) : ${rateLimited[0]}`)
  } else if (profile.issues.length) {
    profile.status = 'partial'
  }
  if (!profile.products.length && !profile.product) profile.status = 'failed'

  profile.durationMs = Date.now() - started
  return profile
}

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
