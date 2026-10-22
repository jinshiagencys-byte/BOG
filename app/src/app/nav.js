// Navigation latérale — structure réelle relevée sur app.testdino.com
export const NAV_GROUPS = [
  {
    label: 'Vue d’ensemble',
    items: [{ to: '/dashboard', name: 'Tableau de bord', icon: 'house' }],
  },
  {
    label: 'Résultats des tests',
    items: [{ to: '/test-runs', name: 'Exécutions de tests', icon: 'list-checks' }],
  },
  {
    label: 'Gestion',
    items: [{ to: '/test-cases', name: 'Cas de test', icon: 'clipboard-list' }],
  },
  {
    label: 'Général',
    items: [{ to: '/settings', name: 'Paramètres', icon: 'settings' }],
  },
]

export const NAV_FLAT = NAV_GROUPS.flatMap((g) => g.items)

// Navigation de l'espace **organisation** (page /projects et ses voisines),
// relevée sur app.testdino.com/org_…/projects : groupes « Workspace » et
// « General », différents du menu d'un projet.
export const ORG_NAV_GROUPS = [
  {
    label: 'Espace de travail',
    items: [
      { to: '/projects', name: 'Projets', icon: 'folder' },
      { to: '/analytics', name: 'Analyses', icon: 'chart-line' },
      { to: '/users', name: 'Utilisateurs et rôles', icon: 'users' },
    ],
  },
  {
    label: 'Général',
    items: [{ to: '/org-settings', name: 'Paramètres', icon: 'settings' }],
  },
]

export const ORG_NAV_FLAT = ORG_NAV_GROUPS.flatMap((g) => g.items)
