/**
 * Planificateur LLM — le schéma de ce qui sera vérifié.
 *
 * Le LLM ne navigue pas et n’exécute rien : il lit le profil factuel du site
 * (produits, prix, tri, recherche, vendeurs) et les cas vagues, puis décide
 * pour chaque cas :
 *   • le motif de test (recherche, fiche, catalogue, tri, annuaire…) ;
 *   • les vérifications attendues, en français, pour l’écran de suivi ;
 *   • les textes qui doivent être réellement visibles (`mustSee`) et ceux qui
 *     ne doivent jamais apparaître (`mustNotSee`).
 *
 * Ces valeurs sont ensuite filtrées : une assertion qui ne correspond à aucun
 * fait observé est écartée. Playwright exécute le scénario déterministe ; le
 * LLM ne fournit ni sélecteur ni script.
 */

const MOTIFS = new Set([
  'search',
  'empty-search',
  'product',
  'catalog',
  'catalog-sort',
  'sellers',
  'navigation',
])

const SYSTEM = `Tu es un planificateur QA. Tu reçois un profil factuel d'un site
(observé par un navigateur) et des cas de test rédigés de façon vague.
Pour chaque cas, choisis un motif parmi : search, empty-search, product,
catalog, catalog-sort, sellers, navigation.
Décris ce qu'il faut vérifier dans "checks", en phrases générales (par exemple
"au moins un produit est listé", "les prix sont croissants"), sans y citer de
valeur précise : les valeurs observées vont uniquement dans "mustSee".
N'invente aucun produit, prix, libellé ni sélecteur.
Réponds uniquement par un objet JSON de la forme :
{"CODE": {"motif": "...", "reason": "...", "checks": ["..."], "mustSee": ["..."], "mustNotSee": ["..."]}}
"mustSee" ne doit contenir que des textes présents dans les faits (titre, prix,
libellé de tri, état, nom de vendeur). "mustNotSee" sert aux messages d'erreur.`

function clean(value, max = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function extractJson(content) {
  const text = String(content ?? '').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    // Certains modèles encadrent le JSON dans un bloc Markdown.
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    try {
      return JSON.parse(fenced[1])
    } catch {
      // continue
    }
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      // continue
    }
  }
  return null
}

/** Faits utiles au plan, sans le corps des pages ni les preuves brutes. */
export function factsForPlan(profile) {
  return {
    site: {
      url: profile?.site?.url ?? null,
      title: profile?.site?.title ?? null,
      heading: profile?.site?.heading ?? null,
      currency: profile?.site?.currency ?? null,
    },
    navigation: (profile?.navigation ?? []).slice(0, 12).map((item) => ({
      label: item.label,
      path: item.path,
    })),
    search: profile?.search
      ? {
          placeholder: profile.search.placeholder || profile.search.label || null,
          sampleTerm: profile.search.sampleTerm ?? null,
          hasResults: profile.search.hasResults === true,
          resultCount: profile.search.resultCountText ?? null,
          emptyTerm: profile.search.emptyTerm ?? null,
          emptyText: profile.emptyState ?? profile.search.emptyText ?? null,
        }
      : null,
    catalog: profile?.catalog
      ? {
          url: profile.catalog.url,
          label: profile.catalog.label,
          count: profile.catalog.count,
          sort: profile.catalog.sort?.options ?? [],
          ascending: profile.catalog.sort?.ascending ?? null,
        }
      : null,
    products: (profile?.products ?? []).slice(0, 8).map((product) => ({
      title: product.title,
      price: product.priceText || product.price,
      seller: product.seller || null,
    })),
    product: profile?.product
      ? {
          title: profile.product.title,
          price: profile.product.priceText,
          availability: profile.product.availability,
          addToCart: profile.product.addToCart,
          seller: profile.product.seller,
        }
      : null,
    sellers: (profile?.sellers ?? []).slice(0, 8).map((seller) => seller.name),
  }
}

function observed(value, factsJson) {
  const needle = clean(value, 160).toLowerCase()
  if (!needle) return false
  return factsJson.toLowerCase().includes(needle)
}

/** Textes qu’un cas peut réellement exiger de voir à l’écran. */
function mustSeeFacts(profile) {
  const values = []
  const push = (value) => {
    if (value) values.push(String(value))
  }
  for (const product of profile?.products ?? []) {
    push(product.title)
    push(product.priceText)
    push(product.seller)
  }
  const product = profile?.product
  if (product) {
    push(product.title)
    push(product.cardTitle)
    push(product.priceText)
    push(product.availability)
    push(product.addToCart)
    push(product.seller)
  }
  push(profile?.search?.sampleTerm)
  push(profile?.search?.resultCountText)
  push(profile?.emptyState)
  push(profile?.search?.emptyText)
  push(profile?.sellersPage?.countText)
  push(profile?.sellersPage?.emptyText)
  push(profile?.sellersPage?.heading)
  for (const seller of profile?.sellers ?? []) push(seller.name)
  return values
}

/**
 * @returns {Promise<null | { plan: Record<string, object>, model: string, usage: object|null }>}
 */
export async function planCases({
  profile,
  cases,
  endpoint,
  apiKey,
  model,
  timeoutMs = 60000,
  extraHeaders = {},
}) {
  if (!apiKey || !endpoint || !model) return null
  const facts = factsForPlan(profile)
  const factsJson = JSON.stringify(facts)
  const mustSeeJson = JSON.stringify(mustSeeFacts(profile))
  const payload = {
    site: facts.site,
    facts,
    cases: (cases ?? []).map((testCase) => ({
      code: testCase.code,
      title: testCase.title,
      description: testCase.description ?? '',
      steps: (testCase.steps ?? []).map((step) => ({
        action: step.action,
        expected: step.expected,
      })),
    })),
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(`${String(endpoint).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1600,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body?.error?.message ?? `HTTP ${response.status}`
    throw new Error(`plan LLM refusé : ${clean(message, 300)}`)
  }

  const parsed = extractJson(body?.choices?.[0]?.message?.content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `plan LLM illisible (JSON attendu) : ${clean(body?.choices?.[0]?.message?.content, 300)}`,
    )
  }

  const plan = {}
  for (const [code, entry] of Object.entries(parsed)) {
    if (!entry || typeof entry !== 'object') continue
    const motif = MOTIFS.has(entry.motif) ? entry.motif : null
    const mustSee = (Array.isArray(entry.mustSee) ? entry.mustSee : [])
      .map((value) => clean(value, 160))
      .filter((value) => value && observed(value, mustSeeJson))
      .slice(0, 6)
    const mustNotSee = (Array.isArray(entry.mustNotSee) ? entry.mustNotSee : [])
      .map((value) => clean(value, 160))
      .filter((value) => value && !observed(value, factsJson))
      .slice(0, 4)
    plan[code] = {
      motif,
      reason: clean(entry.reason, 300),
      checks: (Array.isArray(entry.checks) ? entry.checks : [])
        .map((value) => clean(value, 240))
        .filter(Boolean)
        .slice(0, 8),
      mustSee,
      mustNotSee,
    }
  }

  return {
    plan,
    model,
    usage: body?.usage ?? null,
  }
}
