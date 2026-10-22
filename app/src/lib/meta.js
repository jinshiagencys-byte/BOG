// Métadonnées d'affichage (statuts, environnements, CI, périodes)

export const PERIOD_DAYS = {
  '24h': 1,
  '7days': 7,
  '30days': 30,
  '90days': 90,
  '6months': 182,
  '1year': 365,
  all: Infinity,
}

export const PERIOD_LABEL = {
  '24h': 'Dernières 24 heures',
  '7days': '7 derniers jours',
  '30days': '30 derniers jours',
  '90days': '90 derniers jours',
  '6months': '6 derniers mois',
  '1year': 'Année dernière',
  all: 'Depuis toujours',
}

const STATUS = {
  passed: { label: 'Réussi', icon: 'check', cls: 'bg-passed', text: 'text-white' },
  failed: { label: 'Échoué', icon: 'x', cls: 'bg-failed', text: 'text-white' },
  flaky: { label: 'Instable', icon: 'triangle-alert', cls: 'bg-flaky', text: 'text-white' },
  skipped: { label: 'Ignoré', icon: 'minus', cls: 'bg-skipped', text: 'text-white' },
  interrupted: { label: 'Interrompu', icon: 'ban', cls: 'bg-interrupted', text: 'text-white' },
  incomplete: { label: 'Incomplet', icon: 'circle-dashed', cls: 'bg-incomplete', text: 'text-white' },
  running: { label: 'En cours', icon: 'loader', cls: 'bg-running', text: 'text-white' },
  blocked: { label: 'Bloqué', icon: 'ban', cls: 'bg-blocked', text: 'text-white' },
  active: { label: 'Actif', icon: 'check', cls: 'bg-passed', text: 'text-white' },
  draft: { label: 'Brouillon', icon: 'circle', cls: 'bg-muted-foreground', text: 'text-white' },
}

export function statusMeta(s) {
  return STATUS[s] || { label: s || 'Inconnu', icon: 'circle', cls: 'bg-muted-foreground', text: 'text-white' }
}

// Résultats affichés dans la colonne « Test Results » des exécutions :
// deux statuts seulement, Réussi / Échoué.
export const RESULT_STATUSES = ['passed', 'failed']

export const RESULT_LABEL = {
  passed: 'Réussi',
  failed: 'Échoué',
  blocked: 'Bloqué',
  skipped: 'Ignoré',
}

const ENV_VAR = {
  production: '--env-production',
  staging: '--env-staging',
  development: '--env-development-text',
  testing: '--env-testing',
}

export function envMeta(name, environments = []) {
  if (!name || name === 'unmapped') {
    return { label: 'Non associé', color: 'hsl(var(--env-unmapped))', muted: true }
  }
  const found = environments.find((e) => e.name === name)
  if (!found) return { label: name, color: 'hsl(var(--env-unmapped))', muted: true }
  return {
    label: found.label,
    color: 'hsl(var(' + (ENV_VAR[name] || '--env-unmapped') + '))',
    muted: false,
  }
}

export function ciMeta(ci) {
  if (ci === 'github-actions') return { label: 'GitHub Actions', icon: 'workflow' }
  if (ci === 'local') return { label: 'Local', icon: 'terminal' }
  return { label: ci || '—', icon: 'terminal' }
}

export const PRIORITY_META = {
  critical: { label: 'Critique', cls: 'bg-failed-background text-failed border-failed-border' },
  high: { label: 'Élevée', cls: 'bg-flaky-background text-flaky border-flaky-border' },
  medium: { label: 'Moyenne', cls: 'bg-blue-background text-blue-foreground border-blue-border' },
  low: { label: 'Faible', cls: 'bg-muted text-muted-foreground border-border' },
}
