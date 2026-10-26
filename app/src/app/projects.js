// Projets et organisation de démonstration.
//
// Sur le vrai produit, l'espace organisation liste les projets sous forme de
// cartes (une carte par projet + une carte « Nouveau projet » en pointillés) et
// chaque projet vit sous une URL préfixée par son slug :
//   /org_…/projects/project_…/test-runs   (réel)
//   /DemoProject/dashboard                (clone, slug lisible)

export const DEMO_PROJECT_SLUG = 'DemoProject'
export const DEMO_ORG_NAME = 'Demo Organization'

export const DEMO_PROJECT = {
  slug: DEMO_PROJECT_SLUG,
  name: 'Demo Project',
  category: 'Application web',
  description:
    "Sample Playwright project to explore BOG's reporting and observability features.",
  // « Created 5 August 2026 » sur le vrai site.
  createdAt: '2026-08-05T12:00:00.000Z',
}

// Types de site proposés dans le formulaire de création de projet.
export const PROJECT_CATEGORIES = [
  'E-commerce',
  'Site vitrine (statique)',
  'Application web',
  'Blog / Média',
  'Portfolio',
  'Autre',
]

// « Web app E2E » → « Web-app-E2E », « Boutique Éclat » → « Boutique-Eclat ».
// Les accents sont translittérés (É → E) avant de remplacer les caractères non
// alphanumériques, pour ne pas perdre de lettres dans l'URL.
export function slugify(name) {
  const slug = String(name)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'project'
}

// Date de création au format du site : « 5 August 2026 » (jour sans zéro).
export function formatCreated(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

// Nom affiché pour un slug de projet (le shell projet ne dépend que de l'URL).
export function projectNameFor(slug, projects = []) {
  if (slug === DEMO_PROJECT_SLUG) return DEMO_PROJECT.name
  const found = projects.find((p) => p.slug === slug)
  return found ? found.name : slug
}

// Organisation propriétaire d'un projet : la démo reste dans l'organisation
// « Demo Organization », les projets créés dans l'organisation de l'onboarding.
export function orgNameFor(slug, organization) {
  return slug === DEMO_PROJECT_SLUG ? DEMO_ORG_NAME : organization
}
