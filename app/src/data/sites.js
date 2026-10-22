/* ============================================================
   Surveillance de sites — données d'exemple + KPI du Dashboard.

   Modèle attendu côté base (les clés reprennent celles de la base pour
   que le branchement réel soit direct) :

     sites(id, url, active, crawl_acknowledged, last_status,
           load_time_ms, ssl_days_remaining, created_at)
     page_checks(id, site_id, status 'UP' | 'DOWN', checked_at)

   Les 4 cartes du Dashboard sont **calculées** depuis ces valeurs :
     1. Sites surveillés          → sites actifs, +N ce mois, X en incident
     2. Taux de réussite des checks → page_checks UP / total sur 30 jours
     3. Temps de chargement moyen → moyenne de load_time_ms des sites actifs
     4. SSL à surveiller          → certificats à moins de 30 jours
   ============================================================ */

// Date de création relative, pour que « +N ce mois » reste vrai.
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

export const sites = [
  { id: 'site_01', url: 'https://acme-shop.fr', active: true, crawl_acknowledged: true, last_status: 'UP', load_time_ms: 1180, ssl_days_remaining: 184, created_at: daysAgo(400) },
  { id: 'site_02', url: 'https://www.acme-shop.fr', active: true, crawl_acknowledged: true, last_status: 'UP', load_time_ms: 940, ssl_days_remaining: 184, created_at: daysAgo(400) },
  { id: 'site_03', url: 'https://blog.acme-shop.fr', active: true, crawl_acknowledged: true, last_status: 'UP', load_time_ms: 1620, ssl_days_remaining: 92, created_at: daysAgo(380) },
  { id: 'site_04', url: 'https://help.acme-shop.fr', active: true, crawl_acknowledged: true, last_status: 'UP', load_time_ms: 1240, ssl_days_remaining: 61, created_at: daysAgo(300) },
  { id: 'site_05', url: 'https://api.acme-shop.fr', active: true, crawl_acknowledged: true, last_status: 'UP', load_time_ms: 380, ssl_days_remaining: 210, created_at: daysAgo(300) },
  // En incident : crawl non acquitté + dernier check DOWN.
  { id: 'site_06', url: 'https://partners.acme.io', active: true, crawl_acknowledged: false, last_status: 'DOWN', load_time_ms: 2100, ssl_days_remaining: 24, created_at: daysAgo(240) },
  { id: 'site_07', url: 'https://status.acme.io', active: true, crawl_acknowledged: true, last_status: 'UP', load_time_ms: 620, ssl_days_remaining: 150, created_at: daysAgo(240) },
  { id: 'site_08', url: 'https://docs.acme.io', active: true, crawl_acknowledged: true, last_status: 'UP', load_time_ms: 1380, ssl_days_remaining: 47, created_at: daysAgo(120) },
  // En incident : crawl non acquitté (dernier check UP).
  { id: 'site_09', url: 'https://careers.acme.io', active: true, crawl_acknowledged: false, last_status: 'UP', load_time_ms: 1720, ssl_days_remaining: 300, created_at: daysAgo(90) },
  { id: 'site_10', url: 'https://checkout.acme.com', active: true, crawl_acknowledged: true, last_status: 'UP', load_time_ms: 890, ssl_days_remaining: 61, created_at: daysAgo(45) },
  // Ajoutés ce mois-ci.
  { id: 'site_11', url: 'https://www.acme.com', active: true, crawl_acknowledged: true, last_status: 'UP', load_time_ms: 1450, ssl_days_remaining: 12, created_at: daysAgo(20) },
  { id: 'site_12', url: 'https://app.acme.com', active: true, crawl_acknowledged: true, last_status: 'UP', load_time_ms: 2260, ssl_days_remaining: 365, created_at: daysAgo(12) },
  // En pause : ne comptent pas dans les sites surveillés.
  { id: 'site_13', url: 'https://legacy.acme.com', active: false, crawl_acknowledged: true, last_status: 'UP', load_time_ms: 3100, ssl_days_remaining: 5, created_at: daysAgo(500) },
  { id: 'site_14', url: 'https://staging.acme.dev', active: false, crawl_acknowledged: true, last_status: 'UP', load_time_ms: 780, ssl_days_remaining: 3, created_at: daysAgo(60) },
]

// Séries quotidiennes sur 30 jours (du plus ancien au plus récent). Le filtre
// de période du Dashboard découpe ces séries pour recalculer les KPI.
// Totaux 30 jours : 12 842 checks UP / 476 DOWN, charge moyenne 1,3 s.
export const pageChecksDaily = {
  up: Array.from({ length: 30 }, (_, i) => (i < 2 ? 429 : 428)),
  down: [
    18, 16, 20, 15, 17, 19, 14, 18, 22, 16,
    17, 13, 21, 15, 19, 18, 16, 17, 13, 15,
    14, 19, 18, 10, 13, 12, 9, 15, 14, 13,
  ],
}

export const loadTimeDaily = [
  1300, 1330, 1290, 1340, 1310, 1320, 1300, 1350, 1280, 1330,
  1320, 1290, 1340, 1310, 1300, 1340, 1370, 1420, 1380, 1450,
  1390, 1410, 1450, 1190, 1230, 1200, 1240, 1180, 1260, 1240,
]

// Agrégat des checks de pages sur les 30 derniers jours (table page_checks).
const sum = (values) => values.reduce((total, value) => total + value, 0)
export const pageChecks30d = {
  up: sum(pageChecksDaily.up),
  down: sum(pageChecksDaily.down),
}

/* ---------- Calculs ---------- */

const activeSites = sites.filter((s) => s.active)
const dayMs = 24 * 60 * 60 * 1000

// Un site est « en incident » si son crawl n'est pas acquitté ou si son dernier
// statut est DOWN.
const incidents = activeSites.filter(
  (s) => !s.crawl_acknowledged || s.last_status === 'DOWN',
).length

// Certificat à renouveler sous 30 jours (indépendant de la période affichée).
const sslExpiring = activeSites.filter((s) => s.ssl_days_remaining < 30).length

const formatMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`)
const formatCount = (n) => n.toLocaleString('fr-FR')

// KPI recalculés pour la période choisie (7, 14 ou 30 derniers jours).
export function getSiteKpis(days = 30) {
  const windowDays = Math.max(1, Math.min(30, days))
  const up = sum(pageChecksDaily.up.slice(-windowDays))
  const down = sum(pageChecksDaily.down.slice(-windowDays))
  const checksTotal = up + down
  const successRate = checksTotal ? (up / checksTotal) * 100 : 0
  const avgLoadMs = sum(loadTimeDaily.slice(-windowDays)) / windowDays
  const newSites = activeSites.filter(
    (s) => Date.now() - new Date(s.created_at).getTime() <= windowDays * dayMs,
  ).length

  return [
    {
      key: 'sites',
      label: 'Sites surveillés',
      icon: 'globe',
      value: String(activeSites.length),
      sub: `+${newSites} sur ${windowDays} jours`,
      subTone: newSites > 0 ? 'up' : 'muted',
      tone: newSites > 0 ? 'up' : 'neutral',
      alert: incidents > 0 ? `${incidents} en incident` : null,
    },
    {
      key: 'success',
      label: 'Taux de réussite des checks',
      icon: 'circle-check',
      value: `${successRate.toFixed(1)}%`,
      sub: `${formatCount(up)} / ${formatCount(checksTotal)} checks UP`,
      subTone: 'muted',
      tone: successRate >= 95 ? 'up' : 'down',
      alert: null,
    },
    {
      key: 'load',
      label: 'Temps de chargement moyen',
      icon: 'timer',
      value: formatMs(avgLoadMs),
      sub: `sur ${activeSites.length} sites actifs`,
      subTone: 'muted',
      tone: avgLoadMs < 2000 ? 'up' : 'down',
      alert: null,
    },
    {
      key: 'ssl',
      label: 'SSL à surveiller',
      icon: sslExpiring > 0 ? 'shield-alert' : 'shield-check',
      value: String(sslExpiring),
      sub: sslExpiring > 0 ? 'expirent dans moins de 30 jours' : 'aucun certificat à renouveler',
      subTone: sslExpiring > 0 ? 'warn' : 'muted',
      tone: sslExpiring > 0 ? 'warn' : 'up',
      alert: null,
    },
  ]
}
