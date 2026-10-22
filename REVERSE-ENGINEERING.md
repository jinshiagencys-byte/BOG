# Reverse-engineering de l'UI TestDino (app.testdino.com)

> Réalisé par observation live du dashboard (Chrome DevTools Protocol via les outils
> browser du harness) sur l'organisation de démo « Demo Organization » du compte connecté.
> REA (MCP) n'était pas branché dans la session : les outils browser natifs couvrent le
> même besoin pour une cible web (snapshot DOM, réseau, console, computed styles).

## 1. Stack détectée

| Élément | Valeur observée |
| --- | --- |
| Framework | **Next.js App Router** (React Server Components, `next-route-announcer`, `__next_f`) |
| UI kit | **shadcn/ui** (`data-slot`, variantes `inline-flex items-center …`) |
| Style | **Tailwind CSS** + design tokens CSS custom properties (HSL) |
| Primitives | **Radix UI** (`data-orientation`, `data-state`) |
| Icônes | **lucide**, **iconify** (heroicons / lucide sets) |
| Police | **Geist / Geist Mono** (`--font-sans`, `--font-mono`) |
| Analytics | PostHog (`_ph`) |
| Support | Intercom |
| Progression | NProgress (`#nprogress`) |

### Micro-services (sous-domaines d'API)
- `user.testdino.com` — orgs, projets, environnements, rôles
- `analytics.testdino.com` — runs, filtres, flaky, analytics
- `ai.testdino.com` — AI Insights / classement des échecs
- `integration.testdino.com` — intégrations (GitHub, Jira, Slack, Linear, MCP…)
- `billing.testdino.com` — abonnements / usage
- `changelog-api.testdino.com` — « What's new »

## 2. Modèle de routage

```
/org_{orgId}/projects
/org_{orgId}/projects/{projectId}/test-runs?period=7days&page=1&limit=10
/org_{orgId}/projects/{projectId}/test-runs/{runId}
/org_{orgId}/projects/{projectId}/analytics
/org_{orgId}/projects/{projectId}/test-explorer        # « Flaky tests »
/org_{orgId}/projects/{projectId}/test-controls
/org_{orgId}/projects/{projectId}/pull-requests
/org_{orgId}/projects/{projectId}/test-cases
/org_{orgId}/user-roles
/org_{orgId}/projects/{projectId}/settings?tab=api
```

## 3. Navigation (sidebar réelle)

Groupes tels qu'affichés après ouverture de la sidebar :

| Groupe | Entrées |
| --- | --- |
| Overview | Dashboard, Pull Requests |
| Test Results | Test Runs, Test Explorer, Test Controls |
| Insights | Analytics, AI Insights *(collapsible, teinte `--ai`)* |
| Management | Test Cases, Test Execution *(collapsible)* |
| General | Settings *(collapsible)* |

Header sidebar : sélecteur d'organisation (avatar + nom + chevrons).
Footer sidebar : menu utilisateur (avatar, nom, email, chevrons).

## 4. Chrome de l'application

- **Header** (`h-12`, `px-4`, `border-b border-border/40`) :
  bouton **Toggle Sidebar** → séparateur vertical → **breadcrumb** (dossier + projet › page)
  → recherche « Search TestDino…  Ctrl+K » → checklist onboarding (fusée, badge `3`)
  → changelog (cloche, point rouge) → aide → **toggle thème**.
- **Bannière sandbox** (données de démo en lecture seule) : « You're viewing sample data in a read-only sandbox. Back to … »
- **Zone de contenu** (`p-3 sm:p-5`, scroll vertical) : titre `h1` « Test Runs » + description,
  barre de filtres, carte tableau, pagination.

## 5. Page « Test Runs » — tableau

Colonnes : **Test Run | Commit | Branch & Environment | Test Results | AI Insights**

- **Filtres** : Sync/refresh, *Time Period*, *Status*, *Branch*, *Tags*, *More filters*.
- **Pagination** : « Page 1 of 5 — 50 total », « Last updated: Just now ».

### Structure d'une ligne (réelle)
1. **Test Run** — pastille de statut (`w-5 h-5 rounded-full`), `#counter` (lien),
   éventuel « Re-run of #N » (icône `rotate-ccw`, teinte `--cyan`), durée (icône `timer`),
   provider CI (icône `github` pour GitHub Actions, `terminal` pour `local`).
2. **Commit** — message (tronqué `max-w-[270px]`), hash court `mono`,
   avatar auteur (`w-6 h-6 rounded-full`, `bg-blue-background text-blue-foreground`),
   nom auteur, temps relatif (icône `clock`).
3. **Branch & Environment** — `git-branch` + nom de branche ; badge d'environnement coloré.
4. **Test Results** — 4 badges `mono` : passed / failed / flaky / skipped
   (`bg-*-background text-* border-*-border`) + « Total: N ».
5. **AI Insights** — pastille `bg-ui-background text-ui-text` : `N` + catégorie
   (« UI Change », « Actual Bug », …) ou `-`.

## 6. Modèle de données d'un run (payload réel `analytics…/runs`)

```jsonc
{
  "id": "test_run_…", "counter": 50, "status": "failed",
  "duration_ms": 404692.459, "start_time": "2026-09-24T09:13:45.465Z",
  "is_sharded": false, "is_split": false, "is_swarm": false, "split_anomaly_count": 0,
  "result": { "total": 5, "passed": 0, "failed": 5, "flaky": 0,
              "skipped": 0, "interrupted": 0, "unknown": 0 },
  "metadata": {
    "git_branch": "bhavy/organization", "environment": "unmapped",
    "git_commit_message": "…", "git_commit_hash": "…", "git_commit_author": "…",
    "ci_provider": "github-actions",
    "pr_number": null, "pr_title": null, "pr_status": null, "pr_url": null,
    "pipeline": { "id": "…", "name": "Run Playwright Tests", "url": "…" }
  },
  "tags": [], "is_rerun": true, "rerun_of": { "id": "…", "counter": 49 }, "quarantine": null
}
```

### Environnements (endpoint `user…/environments`)
| name | label | couleur | branches |
| --- | --- | --- | --- |
| production | PROD | `#f42222` | main |
| staging | STAGE | `#f2994a` | dhyey/testing-PR |
| development | DEV | `#f5e6ff` | dev |
| testing | QA | `#64748b` | bhavy/tests |

### Statuts (endpoint `analytics…/filters`)
`passed, failed, interrupted, incomplete, running`

## 7. Design tokens (thème clair, extraits — complets dans `clone/assets/css/theme.css`)

Base neutre (HSL sans unité) :

```
--background 0 0% 97.5%      --foreground 0 0% 0%
--card 0 0% 100%             --card-foreground 0 0% 0%
--muted 0 0% 95%             --muted-foreground 0 0% 32.3%
--border 0 0% 85%            --input 0 0% 92.1%       --ring 0 0% 20%
--primary 0 0% 0%            --primary-foreground 0 0% 100%
--sidebar 0 0% 95.5%         --radius .625rem
--font-sans Geist, Inter     --font-mono Geist Mono
```

Couleurs sémantiques de statut :

| token | couleur | background | border |
| --- | --- | --- | --- |
| `--passed` | `152 60% 38%` | `152 40% 96%` | `152 35% 78%` |
| `--failed` | `0 70% 50%` | `0 50% 96%` | `0 35% 80%` |
| `--flaky` | `40 75% 46%` | `40 50% 95%` | `40 40% 75%` |
| `--skipped` | `210 55% 48%` | `210 40% 96%` | `210 30% 76%` |
| `--interrupted` | `220 20% 45%` | `220 18% 96%` | `220 15% 82%` |
| `--incomplete` | `315 24% 45%` | `315 30% 96%` | `315 22% 80%` |
| `--blue-foreground` | `220 55% 50%` | `220 40% 96%` | `220 35% 82%` |
| `--cyan-foreground` | `187 60% 42%` | `185 40% 96%` | `185 35% 74%` |
| `--amber-foreground` | `32 65% 40%` | `40 50% 94%` | `40 40% 74%` |
| `--ai` | `220 55% 50%` | — | `260 45% 52%` |
| `--ui-text` | `37 45% 38%` | `48 60% 94%` | `50 50% 48%` |

Palette étendue également présente : `purple, rose, magenta, olive, teal, orange,
production/uat/hotfix, quarantined, integration-*, excellent/good/average/poor/critical`.

## 8. Portée du clone livré

`clone/index.html` reproduit fidèlement et **responsive** la page **Test Runs** avec :
- la sidebar réelle (groupes + entrées ci-dessus, repliable en rail d'icônes / tiroir mobile),
- le header complet (breadcrumb, recherche `Ctrl+K`, fusée, cloche, aide, thème),
- la barre de filtres, le tableau (desktop) / cartes (mobile),
- la pagination, un tiroir de détail de run,
- les tokens réels + un **thème sombre** dérivé.

Les 50 runs affichés proviennent des données réelles de la démo (capturées via l'API).
Les catégories « AI Insights » sont dérivées localement (l'API `ai.testdino.com` n'expose
pas ces libellés dans la liste) — à remplacer par la vraie donnée côté back-end.
