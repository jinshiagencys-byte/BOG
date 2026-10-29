/**
 * Enrichisseur de cas — du cas vague au scénario concret.
 *
 * Prend le profil factuel du site (site-explorer) et les cas du manifeste, puis
 * produit pour chacun :
 *   • un scénario Playwright qui utilise les vraies valeurs (produit, prix,
 *     catégorie, terme de recherche) et vérifie un comportement ;
 *   • une version lisible des étapes, avec ces mêmes valeurs.
 *
 * Le classement par motif est déterministe. Un plan LLM peut le corriger
 * (`llmPlan`) sans changer le reste : l’exécution reste jouée par Playwright.
 */

const CURRENCY = '(FCFA|XOF|CFA|EUR|€|USD|\\$|MAD|GNF|NGN|₦)'

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRe(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stepText(step) {
  return `${step?.action ?? ''} ${step?.expected ?? ''}`
}

/** Motif dominant d'un cas, à partir de son titre, sa description et ses étapes. */
export function matchMotif(testCase) {
  const titleMotif = motifFromText(normalize(testCase.title))
  if (titleMotif) return titleMotif
  return motifFromText(
    normalize([testCase.description, ...(testCase.steps ?? []).map(stepText)].join(' ')),
  )
}

function motifFromText(text) {
  if (/aucun|vide|sans resultat|introuvable|zero/.test(text) && /recherche|search/.test(text)) {
    return 'empty-search'
  }
  if (/recherche|rechercher|search/.test(text)) return 'search'
  if (/tri|trier|croissant|decroissant|ordre/.test(text)) return 'catalog-sort'
  // Les pages « annonces » et « artisans » n’ont pas de données produit :
  // on vérifie la navigation et le contenu propre à la page.
  if (/annonce/.test(text)) return 'navigation'
  if (/artisan/.test(text)) return 'navigation'
  if (/vendeur|fournisseur|boutique|annuaire/.test(text)) return 'sellers'
  if (/catalogue|categorie|filtre/.test(text)) return 'catalog'
  if (/fiche|detail|produit|article/.test(text)) return 'product'
  if (/navigation|menu|lien|redirection/.test(text)) return 'navigation'
  return null
}

function currencyOf(profile) {
  return profile?.site?.currency || 'FCFA'
}

function goodPrice(profile, product) {
  return (
    product?.price != null &&
    product?.price > 0 &&
    (!product.priceText || product.priceText.toUpperCase().includes(currencyOf(profile).toUpperCase()))
  )
}

/**
 * Expression exécutée dans la page : les prix des cartes produit visibles.
 * Volontairement proche de la lecture de l'explorateur, mais bornée au DOM.
 */
export function pricesExpression(currency) {
  // Le motif est construit en Node puis transmis comme littéral : pas
  // d’échappement imbriqué fragile dans la page.
  const pattern = `(?:^|[^\\p{L}\\d])(\\d[\\d\\s.,]{0,18}?)\\s*${escapeRe(currency)}`
  const source = `
(() => {
  const re = new RegExp(${JSON.stringify(pattern)}, 'giu');
  const seen = new Set();
  const out = [];
  for (const anchor of document.querySelectorAll('a[href*="/product/"], a[href*="/produit/"], a[href*="/article/"]')) {
    const href = anchor.href;
    if (seen.has(href)) continue;
    seen.add(href);
    let node = anchor;
    for (let depth = 0; depth < 6 && node; depth += 1) {
      const text = (node.innerText || '').trim();
      if (text && text.length < 700) {
        const matches = [...text.matchAll(re)];
        const last = matches[matches.length - 1];
        if (last) {
          out.push(last[0].trim());
          break;
        }
      }
      node = node.parentElement;
    }
    if (out.length >= 24) break;
  }
  return out;
})()`
  return source
}

function sellerNames(profile) {
  return (profile.sellers ?? [])
    .map((seller) => seller.name)
    .filter((name) => name && !/^(vendeurs?|artisans?|boutiques?)$/i.test(name))
}

function urlTerm(term) {
  // Chrome sérialise l’apostrophe en %27 dans l’URL, alors qu’encodeURIComponent
  // la laisse telle quelle : on aligne les deux formes.
  return escapeRe(encodeURIComponent(String(term)).replace(/'/g, '%27'))
}

function buildSearch(profile, testCase) {
  const search = profile.search
  if (!search?.sampleTerm) return null
  const term = search.sampleTerm
  const placeholder = search.placeholder || search.label
  const currency = currencyOf(profile)
  const pattern = urlTerm(term)
  const steps = [
    { action: 'goto', url: profile.site.url },
    { action: 'wait', ms: 1500 },
  ]
  if (placeholder) {
    steps.push({ action: 'fill', placeholder, value: term })
    steps.push({ action: 'press', placeholder, key: 'Enter' })
  } else {
    steps.push({ action: 'fill', selector: 'input[type="search"], input[type="text"]', value: term })
    steps.push({ action: 'press', selector: 'input[type="search"], input[type="text"]', key: 'Enter' })
  }
  steps.push({ action: 'waitForUrl', pattern, timeoutMs: 25000 })
  steps.push({ action: 'wait', ms: 1500 })
  steps.push({ action: 'scrollThrough', steps: 6, pauseMs: 250 })

  return {
    spec: {
      kind: 'playwright',
      steps,
      expect: {
        url: pattern,
        text: [escapeRe(term), currency],
        failIfText: ['Aucun produit trouvé', 'Impossible de charger', 'Erreur 500'],
      },
      label: `la recherche « ${term} »`,
    },
    overlay: {
      steps: [
        { action: `Ouvrir ${profile.site.url}`, expected: 'La page d’accueil s’affiche' },
        {
          action: `Saisir « ${term} » dans le champ « ${placeholder || 'recherche'} » puis valider`,
          expected: 'La recherche est lancée',
        },
        {
          action: 'Attendre les résultats',
          expected: `Des produits correspondant à « ${term} » sont affichés, avec leur prix en ${currency}`,
        },
        {
          action: 'Faire défiler les résultats',
          expected: 'Chaque résultat reste lisible et affiche son prix',
        },
      ],
      data: { term, placeholder },
    },
  }
}

function buildEmptySearch(profile) {
  const search = profile.search
  if (!search?.emptyTerm) return null
  const placeholder = search.placeholder || search.label
  const emptyText = search.emptyText || 'Aucun produit|0 produit|no result'
  const steps = [
    { action: 'goto', url: profile.site.url },
    { action: 'wait', ms: 1200 },
    placeholder
      ? { action: 'fill', placeholder, value: search.emptyTerm }
      : { action: 'fill', selector: 'input[type="search"], input[type="text"]', value: search.emptyTerm },
    placeholder
      ? { action: 'press', placeholder, key: 'Enter' }
      : { action: 'press', selector: 'input[type="search"], input[type="text"]', key: 'Enter' },
    { action: 'waitForUrl', pattern: urlTerm(search.emptyTerm), timeoutMs: 25000 },
    { action: 'wait', ms: 1500 },
    { action: 'scrollThrough', steps: 4, pauseMs: 200 },
  ]
  return {
    spec: {
      kind: 'playwright',
      steps,
      expect: {
        text: [escapeRe(emptyText.split('|')[0].trim())],
        failIfText: ['Impossible de charger', 'Erreur 500', 'Unhandled'],
      },
      label: `l’état vide de la recherche « ${search.emptyTerm} »`,
    },
    overlay: {
      steps: [
        { action: `Ouvrir ${profile.site.url}`, expected: 'La page d’accueil s’affiche' },
        {
          action: `Rechercher « ${search.emptyTerm} », un terme sans résultat`,
          expected: 'La recherche est lancée',
        },
        {
          action: 'Attendre l’état vide',
          expected: `« ${emptyText.split('|')[0]} » s’affiche, sans erreur technique`,
        },
      ],
      data: { term: search.emptyTerm, emptyText },
    },
  }
}

function buildProduct(profile) {
  const product = profile.product
  const title = product?.title || product?.cardTitle
  if (!product?.url || !title) return null
  const currency = currencyOf(profile)
  const text = [escapeRe(title)]
  if (product.priceText && goodPrice(profile, product)) text.push(escapeRe(product.priceText))
  if (product.availability) text.push(escapeRe(product.availability))
  if (product.seller) text.push(escapeRe(product.seller))

  const steps = [
    { action: 'goto', url: product.url },
    { action: 'waitForText', text: title, timeoutMs: 25000 },
    { action: 'scrollThrough', steps: 6, pauseMs: 220 },
  ]
  if (product.addToCart) {
    steps.push({ action: 'waitForText', text: product.addToCart, timeoutMs: 10000 })
  }
  steps.push({ action: 'wait', ms: 800 })

  return {
    spec: {
      kind: 'playwright',
      steps,
      expect: {
        url: '/product/|/produit/|/article/',
        text,
        failIfText: [
          'Produit introuvable',
          'Impossible de charger',
          'n’existe peut-être pas',
          "n'existe peut-être pas",
          'Erreur 500',
        ],
      },
      label: `la fiche « ${title} » à ${product.priceText || currency}`,
    },
    overlay: {
      steps: [
        {
          action: `Ouvrir la fiche « ${title} » (${product.url})`,
          expected: 'La fiche produit s’affiche avec le bon titre',
        },
        {
          action: `Lire le prix affiché`,
          expected: `${product.priceText || 'un prix en ' + currency} est affiché`,
        },
        {
          action: product.availability ? 'Vérifier la disponibilité' : 'Vérifier l’action d’achat',
          expected: product.availability
            ? `« ${product.availability} » est affiché`
            : `« ${product.addToCart || 'Ajouter'} » est proposé`,
        },
        {
          action: 'Faire défiler la fiche jusqu’en bas',
          expected: 'Le prix, la disponibilité et le vendeur restent visibles, sans message d’erreur',
        },
      ],
      data: {
        title,
        price: product.price,
        priceText: product.priceText,
        availability: product.availability,
        seller: product.seller,
      },
    },
  }
}

function buildCatalog(profile, { sort = false } = {}) {
  const catalog = profile.catalog
  if (!catalog?.url) return null
  const currency = currencyOf(profile)
  const ascending = sort ? catalog.sort?.ascending : null
  const steps = [
    { action: 'goto', url: catalog.url },
    { action: 'wait', ms: 1800 },
  ]
  if (ascending) {
    steps.push({ action: 'selectOption', selector: 'select', label: ascending })
    steps.push({ action: 'wait', ms: 1800 })
  }
  // Les listes se chargent au défilement : on parcourt la page avant de
  // relever les prix, sinon on ne vérifie que la première rangée.
  steps.push({ action: 'scrollThrough', steps: 10, pauseMs: 250 })
  steps.push({
    action: 'evaluate',
    as: 'prices',
    expression: pricesExpression(currency),
  })

  const expect = {
    url: new URL(catalog.url).pathname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    failIfText: ['Impossible de charger', 'Erreur 500'],
    collected: { prices: { minCount: 1, ordered: ascending ? 'asc' : undefined } },
  }

  return {
    spec: {
      kind: 'playwright',
      steps,
      expect,
      label: ascending
        ? `le tri du catalogue par prix croissant (${ascending})`
        : `le catalogue ${catalog.label || ''}`.trim(),
    },
    overlay: {
      steps: [
        { action: `Ouvrir le catalogue ${catalog.url}`, expected: 'Les produits sont listés avec leur prix' },
        ascending
          ? { action: `Choisir « ${ascending} » dans le tri`, expected: 'La liste est réordonnée' }
          : { action: 'Lire les prix affichés', expected: 'Chaque produit affiche un prix' },
        ascending
          ? { action: 'Comparer les prix dans l’ordre', expected: 'Les prix sont croissants, sans valeur nulle' }
          : { action: 'Compter les produits', expected: 'Le catalogue contient au moins un produit' },
        {
          action: 'Faire défiler tout le catalogue',
          expected: 'Chaque produit reste visible avec son prix, sans doublon',
        },
      ],
      data: { url: catalog.url, sort: ascending, currency, count: catalog.count },
    },
  }
}

function buildSellers(profile) {
  const page = profile.sellersPage
  const names = sellerNames(profile)
  const url = page?.url || profile.sellers?.[0]?.sourceUrl
  if (!url) return null

  // Annuaire vide : on vérifie ce que la page affiche réellement (compteur ou
  // état vide), au lieu d’attendre un vendeur qui n’est pas listé. `listed`
  // vaut 0 quand les noms viennent seulement des fiches produit.
  if (!names.length || page?.listed === 0) {
    const expected = page?.countText || page?.emptyText || page?.heading
    if (!expected) return null
    return {
      spec: {
        kind: 'playwright',
        steps: [
          { action: 'goto', url },
          { action: 'wait', ms: 1800 },
          { action: 'scrollThrough', steps: 4, pauseMs: 200 },
        ],
        expect: {
          text: [escapeRe(expected)],
          failIfText: ['Impossible de charger', 'Erreur 500'],
        },
        label: `l’annuaire des vendeurs (${expected})`,
      },
      overlay: {
        steps: [
          { action: `Ouvrir ${url}`, expected: 'L’annuaire des vendeurs s’affiche' },
          {
            action: 'Lire le compteur et l’état de la liste',
            expected: `« ${expected} » est affiché`,
          },
        ],
        data: { url, count: expected, sellers: [] },
      },
    }
  }

  return {
    spec: {
      kind: 'playwright',
      steps: [
        { action: 'goto', url },
        { action: 'wait', ms: 1800 },
        { action: 'scrollThrough', steps: 5, pauseMs: 200 },
      ],
      expect: {
        text: [escapeRe(names[0])],
        failIfText: ['Impossible de charger', 'Erreur 500'],
      },
      label: `l’annuaire des vendeurs (${names[0]})`,
    },
    overlay: {
      steps: [
        { action: `Ouvrir ${url}`, expected: 'L’annuaire des vendeurs s’affiche' },
        { action: `Chercher « ${names[0]} »`, expected: 'Le vendeur observé est bien listé' },
        {
          action: 'Faire défiler l’annuaire',
          expected: 'Chaque fiche vendeur reste lisible après défilement',
        },
      ],
      data: { sellers: names.slice(0, 5) },
    },
  }
}

function buildNavigation(profile, testCase = null) {
  const title = normalize(testCase?.title ?? '')
  const candidates = (profile.navigation ?? []).filter(
    (item) => item.path && item.path !== '/' && !/^(#|mailto:|tel:)/i.test(item.href) && item.label,
  )
  // Le titre du cas désigne souvent la page (« annonces », « artisans ») :
  // on choisit le lien dont le libellé apparaît le plus tôt dans le titre.
  const matched = candidates
    .map((item) => ({ item, at: title.indexOf(normalize(item.label)) }))
    .filter((entry) => entry.at >= 0)
    .sort((a, b) => a.at - b.at)
  const target = matched[0]?.item ?? candidates[0]
  if (!target) return null
  const path = new URL(target.href).pathname
  return {
    spec: {
      kind: 'playwright',
      steps: [
        { action: 'goto', url: profile.site.url },
        { action: 'wait', ms: 1200 },
        { action: 'click', text: target.label },
        { action: 'waitForUrl', pattern: escapeRe(path), timeoutMs: 20000 },
      ],
      expect: { url: escapeRe(path) },
      label: `la navigation vers « ${target.label} »`,
    },
    overlay: {
      steps: [
        { action: `Ouvrir ${profile.site.url}`, expected: 'La page d’accueil s’affiche' },
        { action: `Cliquer sur « ${target.label} »`, expected: `La page ${path} s’ouvre` },
      ],
      data: { label: target.label, path },
    },
  }
}

const BUILDERS = {
  search: (profile) => buildSearch(profile),
  'empty-search': (profile) => buildEmptySearch(profile),
  product: (profile) => buildProduct(profile),
  catalog: (profile) => buildCatalog(profile),
  'catalog-sort': (profile) => buildCatalog(profile, { sort: true }),
  sellers: (profile) => buildSellers(profile),
  navigation: (profile, testCase) => buildNavigation(profile, testCase),
}

function checksFromSpec(spec) {
  const checks = []
  const expect = spec.expect ?? {}
  if (expect.url) checks.push(`L’URL contient « ${expect.url} »`)
  for (const pattern of expect.text ?? []) {
    checks.push(`Un texte correspondant à « ${pattern} » est visible à l’écran`)
  }
  if ((expect.text ?? []).length) {
    checks.push('Chaque texte attendu est amené à l’écran par défilement avant validation')
  }
  for (const [name, rule] of Object.entries(expect.collected ?? {})) {
    const ordered =
      rule.ordered === 'asc'
        ? ', ordonnées croissantes'
        : rule.ordered === 'desc'
          ? ', ordonnées décroissantes'
          : ''
    checks.push(`${name} : au moins ${rule.minCount ?? 1} valeur(s)${ordered}`)
  }
  return checks
}

/**
 * @returns {{ specs: Record<string, object>, overlays: Record<string, object>, skipped: Array<{code:string,reason:string}> }}
 */
export function enrichCases({ profile, cases, llmPlan = null }) {
  const specs = {}
  const overlays = {}
  const skipped = []

  for (const testCase of cases ?? []) {
    const code = testCase.code
    if (!code) continue
    const guidance = llmPlan?.[code] ?? null
    const motif = guidance?.motif || matchMotif(testCase)
    const builder = BUILDERS[motif]
    if (!builder) {
      skipped.push({ code, reason: 'motif inconnu' })
      continue
    }
    let built = null
    try {
      built = builder(profile, testCase)
    } catch (error) {
      skipped.push({ code, reason: String(error?.message ?? error).slice(0, 160) })
      continue
    }
    if (!built) {
      skipped.push({ code, reason: `données absentes pour « ${motif} »` })
      continue
    }

    // Le plan LLM ne remplace pas le scénario : il ajoute des vérifications
    // déjà présentes dans les faits observés, et écarte les erreurs connues.
    const expect = { ...(built.spec.expect ?? {}) }
    if (guidance?.mustSee?.length) {
      expect.text = [...new Set([...(expect.text ?? []), ...guidance.mustSee.map(escapeRe)])]
    }
    if (guidance?.mustNotSee?.length) {
      expect.failIfText = [
        ...new Set([...(expect.failIfText ?? []), ...guidance.mustNotSee.map(escapeRe)]),
      ]
    }
    built.spec.expect = expect

    specs[code] = built.spec
    overlays[code] = {
      motif,
      source: guidance ? 'llm+crawler' : 'crawler',
      reason: guidance?.reason ?? null,
      checks: [
        ...new Set([...(guidance?.checks ?? []), ...checksFromSpec(built.spec)]),
      ].slice(0, 12),
      enriched_at: new Date().toISOString(),
      profile_captured_at: profile?.captured_at ?? null,
      steps: built.overlay.steps,
      data: built.overlay.data,
    }
  }

  return { specs, overlays, skipped }
}
