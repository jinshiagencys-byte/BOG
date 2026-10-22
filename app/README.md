# TestDino-like — app React

Clone **fidèle et responsive** de l'UI réelle de `app.testdino.com`, reconstruit en
**React + Vite + Tailwind v4**. Il couvre pour l'instant cinq vues :

| Vue | Route | État |
| --- | --- | --- |
| **Test Runs** | `/DemoProject/test-runs` | ✅ porté depuis le clone HTML validé |
| **Test Cases** | `/DemoProject/test-cases` | ✅ arbre de suites, vue groupée, drag & drop, tiroir de détail, création/édition inline, renommage et suppression de suite |
| **Dashboard** | `/DemoProject/dashboard` | ✅ 4 KPI + Pass/Fail Trend (réplique recharts à l'identique) |
| **Onboarding** | `/onboarding` | ✅ « Create your organization » (plein page, hors du shell) |
| **Auth** | `/auth` · `/auth/signup` | ✅ connexion et création de compte (plein page, hors du shell) |
| **Projects** | `/projects` | ✅ espace organisation : cartes de projet + création avec catégorie de site, client, URL, responsable et fréquences de suivi |

La sidebar ne reprend que les entrées utiles : **Dashboard**, **Test Runs**,
**Test Cases** et **Settings** (ce dernier affiche un écran « à venir »).

> **Architecture V2** : voir [`supabase/README.md`](../supabase/README.md) pour les
> migrations, les Edge Functions, la sécurité et le workflow GitHub Actions.

Comme sur le vrai site, les URLs d'un projet sont **préfixées par son slug** :
`/DemoProject/dashboard`, `/DemoProject/test-runs`, … Les anciennes URLs à plat
(`/dashboard`, `/test-runs`…) redirigent vers le projet de démo, et `/` ouvre
`/DemoProject/dashboard`.

## Lancer

```bash
cd app
npm install
npm run dev      # http://127.0.0.1:5173
```

Autres scripts : `npm run build`, `npm run preview`, `npm run lint`.

## Stack

- **React 19** + **Vite 8**
- **Tailwind CSS v4** via `@tailwindcss/vite` (tokens exposés en `@theme`, ex. `bg-passed-background`,
  `text-muted-foreground`, `border-border`)
- **react-router-dom 7** (routes `/test-runs`, `/test-cases`, `/dashboard`)
- **lucide-react** pour les icônes (map explicite dans `src/components/Icon.jsx`)
- **recharts 3.5.1** (épinglé) pour le graphe *Pass / Fail Trend* du dashboard

> `vite.config.js` active `server.watch.usePolling` : sur les systèmes de fichiers montés
> (containers), le watcher inotify ne remonte pas toujours les modifications et Vite sert
> alors un module périmé (HMR qui « ne prend pas »). Le polling rend le HMR fiable.

## Structure

```
app/src/
├── index.css                 # tokens de thème réels (clair + sombre) + @theme Tailwind
├── styles/components.css     # composants portés du clone (tableau, badges, drawer, palette…)
├── app/
│   ├── context.jsx           # AppProvider (thème, tiroir de run, palette, org + projets)
│   ├── app-context.js        # contexte + hook useApp
│   ├── nav.js                # sidebars d'un projet (4 groupes) et de l'organisation
│   └── projects.js           # slug/URL des projets, nom d'organisation, date de création
├── components/
│   ├── AppShell.jsx          # layout : sidebar + header + <Outlet/> (`variant="org"` pour l'organisation)
│   ├── Sidebar.jsx           # 4 groupes réels + sélecteur d'org + user (Agency's Jinshi)
│   ├── OrgSidebar.jsx        # espace organisation : Workspace/General + utilisateur
│   ├── OrgSwitcher.jsx       # menu « Organizations » (switcher + Manage/New organization)
│   ├── Header.jsx            # fil d'ariane + sélecteur de projet, recherche Ctrl+K, cloche, thème
│   ├── OrgHeader.jsx         # fil d'ariane « Organisation > Page », cloche, thème
│   ├── ChangelogBell.jsx     # cloche partagée par les deux headers
│   ├── ChangelogDialog.jsx   # dialogue « TestDino Changelog » ouvert par la cloche
│   ├── Markdown.jsx          # rendu Markdown du changelog (mêmes classes que la prod)
│   ├── CreateProjectModal.jsx # modale « Create / Edit project » de la page Projects
│   ├── CommandPalette.jsx    # recherche de runs (Ctrl+K)
│   ├── RunDrawer.jsx         # tiroir d'un run (onglets Réussi / Échoué, preuve, relance)
│   ├── RunRow.jsx            # ligne / carte de run partagée (vue Test Runs)
│   ├── Icon.jsx              # wrapper lucide-react
│   ├── bits.jsx              # StatusDot, EnvBadge, ResultBadges, Popover, PriorityBadge…
│   └── testcases/            # vue Test Cases (portée de la référence index.html)
│       ├── SuiteTree.jsx     # arbre de suites + cibles de dépôt
│       ├── GroupedTable.jsx  # vue groupée (en-têtes de suite, lignes draggables)
│       ├── CaseDrawer.jsx    # tiroir de détail (Overview / Steps Classic-Gherkin…)
│       └── Toast.jsx         # notification de fin de drag & drop / création
├── data/
│   ├── runs.js               # 50 runs réels de la démo + environnements + filtres
│   ├── suites.js             # arbre de suites réel (431 cas) — utilisé par le tiroir des runs
│   ├── casePacks.js          # packs de cas de test pré-générés par type de site
│   ├── changelog.js          # 6 entrées « web-app » réelles du changelog (API publique)
│   ├── dashboard.js          # tendance Pass/Fail réelle + métriques 30 j conservées
│   └── sites.js              # sites surveillés + page_checks → 4 cartes KPI calculées
├── lib/                      # format.js (durées, time ago…), meta.js (statuts, envs, CI)
└── views/                    # TestRunsView, TestCasesView, DashboardView, OnboardingView, ProjectsView, PlaceholderView
```

## Fidélité

Les tokens et composants proviennent de l'observation live du dashboard réel,
avec des valeurs vérifiées par styles calculés :

| Élément | Valeur |
| --- | --- |
| Fond application | `rgb(249, 249, 249)` |
| Sidebar | `rgb(244, 244, 244)`, largeur 224 px (14 rem) |
| Header | hauteur 48 px |
| Badge *passed* | fond `rgb(241, 249, 245)`, texte `rgb(39, 155, 101)` |
| Thème sombre (fond) | `rgb(18, 18, 18)` |
| Police | Geist / Geist Mono |

Structure des données réelles reprises à l'identique : 50 runs et l'arbre de suites
d'origine (`MCP smoke`, `Pull Requests`, `Test Explorer`, `Test Cases`, `Test Runs`,
`AI Insights`, `Analytics`, `Authentication`, `Checkout`, `Dashboard`, `Settings 135`,
`Organization Management 57`, …), KPI 30 j (`164` tests suivis, `32%` pass, `55.5`,
`7m 49s`). Cet arbre (431 cas) alimente encore le tiroir des runs ; la vue **Cas de test**
génère désormais ses propres packs selon la catégorie du projet (voir plus bas).

## Cloche « What's new » (changelog)

La cloche du header n'est pas un centre de notifications : sur le site réel elle ouvre le
**changelog produit** (`aria-label` = `What's new`, `data-testid` = `changelog-bell-btn`).

- **Source des données** : API publique `https://changelog-api.testdino.com/api/v1/changelog?sortBy=publishDate&limit=15`
  (aucune authentification). Le flux renvoie 15 entrées (`changelogType` ∈ `web-app` | `cli` | `mcp`) ;
  **seules les 6 entrées `web-app` sont conservées** dans `src/data/changelog.js` (les 9 entrées
  `cli`/`mcp` ont été retirées à la demande) : titre, version, date (`Oct 12, 2026`), type et
  `body` en Markdown brut.
- **Contenu du dialogue** (répliqué du DOM de prod) :
  - en-tête `TestDino Changelog` + filtres produit `All · Web App` (pastilles arrondies,
    l'actif est en `bg-foreground text-background`) — les filtres `CLI` et `MCP` du site ont
    été retirés, comme leurs entrées ;
  - badge produit coloré par type : Web App → `bg-skipped-background text-skipped`
    (les classes `MCP` → `passed` et `CLI` → `flaky` restent dans `ChangelogDialog.jsx`
    au cas où leurs entrées seraient réintroduites) ;
  - ligne de méta : badge `vX.Y.Z` `·` date, titre tronqué (`truncate text-sm font-semibold`)
    et chevron qui pivote à 180° quand l'entrée est dépliée ;
  - accordéon **une seule entrée ouverte** : la plus récente est dépliée par défaut, un clic
    sur une autre referme la précédente ;
  - pied : lien `View full changelog` → `https://changelog.testdino.com/` ;
  - fermeture par la croix, par clic sur l'overlay (`bg-black/80`) ou par `Échap`.
- **Rendu Markdown** (`components/Markdown.jsx`) : petit moteur maison qui reproduit la sortie
  `react-markdown` du site (titres `h1`–`h4`, paragraphes, listes à puces imbriquées
  `list-disc`/`list-[circle]`, gras, italique, code en ligne, blocs ` ```lang `, liens,
  images) avec **les mêmes classes** que la prod — par exemple
  `h3` = `border-b border-border/70 pb-1.5 text-base font-semibold first:mt-0` et le code
  en ligne = `px-1 py-0.5 rounded bg-muted ...`.
- **Logique « non vu »** (identique au site) : la version de la dernière entrée est comparée à
  `localStorage.td_changelog` (`{"v":"3.6.0"}`). Si elle diffère (ou si la clé est absente),
  la cloche affiche une pastille rouge (`h-2 w-2 bg-red-500 ring-2 ring-background`,
  `absolute top-1 right-1`) et son libellé devient `What's new — unseen updates`. **Ouvrir
  le dialogue marque immédiatement le changelog comme vu** (clé écrite, pastille retirée).

## Vue Dashboard

Quatre **cartes KPI de surveillance** (remplacées à la demande), puis la carte
**Pass / Fail Trend** (pleine largeur). Par rapport au dashboard réel, les trois cartes du
bas (*Most Flaky Tests*, *Degrading Tests*, *Chronic Failures*) et le **Branch Summary**
ont été **retirés** — il ne reste que les KPI et le graphe.

> **Jeu d'exemple réservé à la démo** : ces KPI et le graphe ne s'affichent que dans le
> projet `DemoProject`. Un projet créé depuis `/projects` affiche à la place un **état vide**
> (« Aucune donnée de surveillance pour ce projet ») avec un lien vers le projet de démo.
> Rien n'est inventé pour les projets réels en attendant le branchement Supabase.

Les deux contrôles de la barre sont fonctionnels : le **filtre de période** ouvre un menu
(7 / 14 / 30 derniers jours) et recalcule **les 4 KPI ainsi que la courbe** sur la période
choisie ; **Actualiser** lance une courte rotation de l'icône et affiche le toast
« Dashboard actualisé. ». Les KPI dépendant de la période (nouveaux sites, taux de réussite,
temps de chargement) sont recalculés ; le nombre de sites actifs et les SSL restent des
instantanés courants.

| Carte | 7 jours | 14 jours | 30 jours |
| --- | --- | --- | --- |
| **Sites surveillés** | `12` · `+0 sur 7 jours` | `12` · `+1 sur 14 jours` | `12` · `+2 sur 30 jours` |
| **Taux de réussite des checks** | `97.2%` · `2 996 / 3 082` | `96.8%` · `5 992 / 6 190` | `96.4%` · `12 842 / 13 318` |
| **Temps de chargement moyen** | `1.2s` | `1.3s` | `1.3s` |
| **SSL à surveiller** | `2` | `2` | `2` |

| Carte | Calcul |
| --- | --- |
| **Sites surveillés** | `sites` avec `active = true` ; `+N` = `created_at` dans la fenêtre (7/14/30 j) ; pastille rouge `2 en incident` = `crawl_acknowledged = false` **ou** `last_status = 'DOWN'` |
| **Taux de réussite** | `pageChecksDaily` découpé sur la fenêtre : `UP / (UP + DOWN)` |
| **Temps de chargement** | moyenne de `loadTimeDaily` sur la fenêtre |
| **SSL à surveiller** | instantané courant : certificats avec `ssl_days_remaining < 30` (indépendant de la période) |

Les valeurs sont **calculées** dans `src/data/sites.js` par `getSiteKpis(days)` à partir d'un
jeu d'exemple (`sites` + séries quotidiennes `pageChecksDaily` / `loadTimeDaily`, plus
`pageChecks30d` pour l'agrégat) dont les clés reprennent celles de la base : brancher la
vraie source revient à remplacer ces exports. Le ton de la carte suit le seuil
(vert/rouge/ambre) et l'icône de tête reflète l'état (`globe`, `circle-check`, `timer`,
`shield-alert` ⇄ `shield-check`).

Les anciens KPI de TestDino (`Tracked tests`, `Run Pass Rate`, `Reliability Score`,
`Avg Test Time per Run`) ont été retirés ; les autres métriques capturées restent dans
`src/data/dashboard.js` (commentaires d'en-tête) au cas où on voudrait les rebrancher.

La carte ligne/run (`components/RunRow.jsx`, `RunRow` / `RunCard`) reste le composant
partagé utilisé par la vue **Test Runs** (tableau desktop + cartes mobiles).

La carte **Pass / Fail Trend** reprend le **rendu** de celle de `app.testdino.com` : même
bibliothèque (**recharts**, épinglée en `3.5.1`, la version majeure utilisée par le site
réel), mêmes props, mêmes ticks et même interaction. Ses **données** sont en revanche
dérivées de `runs.results` (et non plus du snapshot brut `activity_sparkline`) pour que le
graphe, les badges et les totaux du tableau Test Runs affichent exactement les mêmes
chiffres.

| Élément | Réglage répliqué |
| --- | --- |
| Type | `AreaChart` + `Area type="monotone"`, marge `{top:10,right:40,left:0,bottom:0}` |
| Données | 30 runs `#21` → `#50` (`{run, passed, failed}`), dérivés de `runs.results` (mêmes chiffres que le tableau Test Runs), dans l'ordre chronologique ; tronquées aux 7 / 14 / 30 derniers runs selon le filtre |
| Dégradés | `linearGradient` verticaux `dashColorPassed` / `dashColorFailed`, stops `5%` (opacité `0.8`) → `95%` (`0.1`), `fillOpacity` recharts `0.6` |
| Trait | `hsl(var(--passed))` / `hsl(var(--failed))`, épaisseur 1 |
| Grille | horizontale seulement, `strokeDasharray="3 3"`, `hsl(var(--border) / 0.5)` |
| Axes | `text-xs` + `fill-muted-foreground`, sans ligne ni ticks, Y `domain=[0,40]` / `ticks=[0,10,20,30,40]`, X `interval="preserveStartEnd"` |
| Survol | curseur vertical `hsl(var(--border))` + carte `140 px` (titre `Exécution #NN`, `Réussis`/`Échoués` avec pastilles, séparateur, `Total`) |
| Conteneur | hauteur `250 px`, contour retiré (`.td-chart` dans `styles/components.css`) |

La bannière de la sandbox de démo (« You're viewing sample data in a read-only
sandbox… ») a été **retirée** de l'app : `AppShell.jsx` n'affiche plus que le header
puis la vue.

## Page Onboarding

`/onboarding` reproduit l'écran **« Create your organization »** du vrai produit : plein page,
**hors du shell** (ni sidebar ni header), comme sur le site où il s'affiche tant qu'aucune
organisation n'existe.

- Logo centré (icône + `TestDino`), puis une carte de **25 rem** (`border-radius .75rem`,
  `1px` de bordure, `background: --card`, padding `1.5rem`) : titre `1.5rem/700`,
  sous-titre `0.875rem` muted sur 2 lignes, puis 2 champs obligatoires (astérisque rouge) :
  - **Organization Name** — champ de `2.25rem`, autofocus ;
  - **Team Size** — 6 boutons `1 · 2-10 · 11-50 · 51-100 · 101-250 · 250+` sur une grille
    `3 × 2` + hint « You can invite teammates after setup ».
- Bouton plein largeur `Create organization` (`--primary` : noir en clair, blanc en sombre —
  d'où le bouton blanc de la capture en thème sombre) puis la mention légale
  *Privacy Policy / Terms of Service*.
- Focus des champs et sélection des tailles d'équipe en **indigo** (`--onb-accent`), comme le
  halo violet visible autour du champ actif sur le site.
- À la soumission : validation des 2 champs (messages sous les champs concernés +
  `aria-invalid`), enregistrement du nom dans le contexte (`organization`) puis
  **redirection vers `/projects`** — l'espace organisation qui invite à créer un projet.

> Les sections **Expected Test Volume** et **How You Found Us** du vrai écran ont été
> retirées (choix produit) : leurs libellés n'étaient visibles qu'en partie sur les captures.

## Pages d'authentification — `/auth` et `/auth/signup`

Reproduites depuis les captures du vrai produit, en **anglais** comme sur les écrans
d'origine (le reste de l'app reste en français), **plein page hors du shell** :

- **`/auth` — Sign in to TestDino** : logo + wordmark, bouton **Continue with Google**
  (logo multicolore), bouton **Continue with SSO** (icône building), séparateur **OR**,
  champs e-mail et mot de passe (bouton œil pour afficher/masquer), **Remember me**
  (l'adresse est conservée dans `localStorage.td-remember-email`),
  **Forgot password?** (message de confirmation), bouton noir **Sign in**, pied
  « Don't have an account? Create an account ».
- **`/auth/signup` — Create your account** : Google, séparateur, nom complet, e-mail,
  mot de passe, case **I agree to the Terms of Service and Privacy Policy**, bouton
  **Create account** (gris et désactivé tant que les conditions ne sont pas acceptées,
  comme sur la capture), pied « Already have an account? Sign in ».

Comportements de démo : validation des champs (messages d'erreur sous forme de bandeau),
connexion → `/projects`, création de compte → `/onboarding`, boutons OAuth → message
« not available in this demo ». Les routes de l'app **ne sont pas protégées** : la page
est accessible directement, aucune session n'est requise.

## Espace organisation — `/projects`

C'est l'écran d'arrivée après l'onboarding : le vrai produit affiche « l'organisation
courante » avec ses projets. Le clone reprend l'espace **organisation**
(≠ espace projet) avec son propre shell (`AppShell variant="org"`) :

- **Sidebar organisation** (`OrgSidebar.jsx`) : sélecteur d'organisation, groupes
  **Workspace** (`Projets`, `Analyses`, `Utilisateurs et rôles`) et **Général**
  (`Paramètres`), puis la ligne utilisateur (`Agency's Jinshi` / `jinshiagencys@gmail.com`).
- **Sélecteur d'organisation** (`OrgSwitcher.jsx`, partagé par les deux sidebars) : il ouvre le
  menu du vrai site — libellé `Organizations`, organisations (avec `Read-only sample data` sous
  la sandbox et une coche sur l'organisation courante), `Manage Organization`, `Manage Team`,
  puis `New Organization`. Choisir une organisation bascule d'espace et ouvre **sa** page
  Projects : `Agencys Organization` (FREE, projet de l'onboarding) ou `Demo Organization`
  (TEAM, `1 of 5 projects used`, `Demo Project`, sandbox en lecture seule).
- **Header** (`OrgHeader.jsx`) : bouton de repli de la sidebar, fil d'ariane
  `Organisation > Page`, cloche du changelog et bascule de thème. Pas de recherche : la page
  organisation du vrai produit n'en a pas.
- **Contenu** : titre `Projects` + badge de plan (`FREE` bordé, `TEAM` en dégradé pour la
  sandbox) + séparateur + compteur (`0 of 1 projects used` en gratuit, `1 of 5` pour la démo),
  puis les projets en **cartes de 280 px côte à côte** (`flex-wrap` + `gap 1rem`, pleine largeur
  sous 640 px) : nom 16 px/600 tronqué, menu `…` (Edit / Delete), description sur 2 lignes
  (hauteur minimale 40 px pour aligner les pieds de carte) et pied `Created 5 August 2026` avec
  icône calendrier.
- **Carte « New Project » en pointillés** : même largeur, `+` dans un carré pointillé,
  sous-titre `Click to create a new project and start tracking your tests.` — remplacé par
  `Upgrade to add more projects` dès que la limite du plan est atteinte, et **désactivée** dans
  la sandbox de démo (lecture seule). Elle ouvre la modale `CreateProjectModal.jsx` (25 rem) :
  **Nom du projet** \*, **Catégorie** \* (liste déroulante : E-commerce, Site vitrine (statique),
  Application web, Blog / Média, Portfolio, Autre), **Nom du client** \*, **URL** \*,
  **Responsable** \*, **Fréquence de vérification (heures)** \*, **Fréquence de notification
  (heures)** \* et **Description**, avec `Annuler` / `Créer le projet` en pied.
- **Créer un projet** ajoute sa carte, passe le compteur à `1 sur 1 projets utilisés` et bascule le
  sous-titre de la carte pointillés sur l'upsell. La catégorie est enregistrée avec le projet et
  affichée en **pastille arrondie** (icône étiquette) sous la description de la carte ; le champ
  est pré-rempli à la modification. Cliquer la carte ouvre le projet sous son slug
  (`/Web-app-E2E/dashboard`) ; le menu `…` permet de le renommer (Modifier) ou de le supprimer.
  Les projets créés sont conservés dans `sessionStorage` (`td-projects`).
- Les autres entrées de la sidebar organisation (`/analytics`, `/users`,
  `/org-settings`) mènent à des pages d'attente — elles n'ont pas été clonées.
  `Facturation et utilisation` a été retirée du menu (la route `/billing` existe toujours
  pour le lien d'upsell « Passer à une offre supérieure »).

## Vue Test Runs

Tableau simplifié à **3 colonnes** : `Exécution` (statut, id, durée),
`Suite de tests` (suite exécutée + horodatage) et `Résultats des tests` (badges + total).

> **Les 50 exécutions d'exemple appartiennent au projet `DemoProject`.** Un projet créé
> affiche un **état vide** (« Aucune exécution de test », pas de pagination, libellé
> « En attente de la première exécution ») et la palette `Ctrl K` ne remonte aucun run.
> Les projets réels resteront vides jusqu'à l'arrivée des vraies exécutions (Supabase).
L'auteur, le fournisseur de CI (GitHub Actions / Local…), les badges **PR #** et
**Nouvelle tentative de #** ont été retirés des lignes, des cartes mobiles et du tiroir.

Sous le numéro, **à côté de la durée**, un run `failed` pas encore relu affiche la mention
**rouge « · à acquitter »** (`.td-ack`, `hsl(var(--failed))`). Un clic dessus acquitte le run :
la mention disparaît et un toast confirme (« Exécution #50 acquittée. »). L'état est conservé
en `sessionStorage` (`td-acked-runs`), donc un rechargement ne la fait pas réapparaître.

La colonne **Résultats des tests** n'affiche que **deux statuts** : **Réussi** (vert) et
**Échoué** (rouge). L'API expose des statuts intermédiaires : `src/data/runs.js` replie
`flaky + interrupted + unknown` et les runs `incomplete` / `interrupted` sur `failed`, et
les résultats `blocked` / `skipped` sont comptés comme des échecs — le total du run est donc
toujours conservé (`passed + failed = total`). Le tiroir de détail reprend la structure du
tiroir **Cas de test** (même largeur, fil d'ariane, pagination, boutons imprimer/fermer)
avec **deux onglets : Réussi et Échoué** (l'onglet ouvert par défaut correspond au statut
du run). Chaque onglet liste les cas de test de la suite sous forme de cartes :

- **Réussi** : fond vert, coche, identifiant + titre en vert et postcondition du cas.
- **Échoué** : fond rouge, croix, identifiant + titre en rouge, message d'échec et deux
  actions : **Voir la preuve** (déplie les étapes et résultats attendus du cas) et
  **Acquitter et relancer** (passe le bouton en « Relance demandée »).

La démo ne stocke pas le résultat cas par cas : les échecs du run sont répartis sur les cas
de la suite (`testCases.filter(c => c.suite === run.suite)`). Les anciennes sections
Résumé / Résultats / Détails et le bloc **Analyses par IA** ont été retirés du tiroir —
la date, la durée et le nombre de tests restent affichés sous la pastille de statut.
Filtres : période, **Statut** (Réussi / Échoué, avec un simple point de couleur, sans icône)
et **Autres filtres** (environnement + CI). Les colonnes `Commit`,
`Branch & Environment` et `AI Insights` ainsi que les filtres **Branch** et **Tags** ont été
retirés. Les pastilles de statut (lignes, cartes, tiroir, palette de commandes) sont
de simples **points de couleur**, sans icône à l'intérieur.

Les horodatages figés de l'API de démo (24 sept. 2026) sont **recalés sur l'heure de
chargement** dans `src/data/runs.js`, en conservant les écarts entre exécutions : les filtres
restent donc cohérents (24 h → 8 runs, 7 j → 8, 30 j → 22, 90 j et 6 mois → 50). Ce recalage
est à retirer lors du branchement Supabase, qui fournira les vraies dates.

La **suite** de chaque run est dérivée de l'arbre de suites réel (`data/suites.js`) :
l'API `runs` de la démo ne remonte pas ce champ (`src/data/runs.js` → `RUN_SUITES`).

## Vue Test Cases

Cette vue reprend les patterns UX de la référence `../index.html` fournie par
l'utilisateur (icônes, affichage des tests, drag & drop) plutôt que la table 7 colonnes
du site réel :

- **En-tête** : titre + sous-titre (**catégorie du projet**) + **coverage meter**
  (`N/N` cas générés, 100 %).
- **Toolbar** : recherche, **Options** (regrouper par suite), **Refresh**,
  **Déclenché**, **Export**, **Settings**. Le bouton **Déclenché** (icône play) est
  **grisé et désactivé** tant qu'aucun cas n'est coché ; il déclenche les cas
  sélectionnés avec un toast de confirmation. Un **second déclenchement de la même
  sélection** avant la fin de l'action affiche « Une action est déjà en cours pour les
  éléments sélectionnés. » avec une **croix rouge** (les confirmations gardent la coche
  verte). Simulation locale de 10 s, en attendant la base : l'état « en cours » viendra
  ensuite des vrais runs.
- **Arbre de suites** (colonne gauche, sticky ≥ 1024 px) : « All test cases », une
  **coche maître** à côté de « Tous les cas de test » (sélectionne/désélectionne tout le
  projet, indéterminée si une partie seulement est cochée), une **case à cocher par
  suite** (même logique), dossiers pliables, compteurs par suite, bouton `+` au survol.
  Tout est synchronisé avec les cases des lignes et les en-têtes de groupe.

### Génération des cas selon le type de site

Chaque projet porte une **Catégorie** (E-commerce, Site vitrine, Application web,
Blog / Média, Portfolio, Autre) choisie dans le formulaire. La vue Cas de test charge
automatiquement le pack correspondant (`src/data/casePacks.js`), sans saisie manuelle :

- **exploration commune** à la plupart des sites (16 cas) : Navigation (4), Contenu et liens
  (4), Formulaires (3), Responsive et affichage (3), Référencement et performance (2) ;
- **parcours spécifiques** au type, affichés en tête : pour l'E-commerce, 9 suites et
  25 cas — *Catalogue et recherche* (2), *Fiche produit* (1), *Panier et commande* (3),
  *Paiement et confirmation* (4), *Compte client* (4), *Livraison et retours* (3),
  *Promotions et codes* (3), *Filtres et tri* (3), *Avis et favoris* (2). Les trois
  premières suites reproduisent l'exemple fourni (`TC-ECOM-001` → `TC-ECOM-006`).

Volumes générés : **41 cas / 14 suites** pour l'E-commerce, **44 / 13** pour une application
web, **36 / 13** pour un site vitrine, **38 / 13** pour un blog, **35 / 12** pour un portfolio
et **34 / 11** pour « Autre ». Les identifiants suivent le type de site et sont numérotés en
continu : `TC-ECOM-001`…`TC-ECOM-041`, `TC-APP-001`…`TC-APP-044`, `TC-SITE-001`…,
`TC-BLOG-001`…, `TC-PORT-001`…, `TC-GEN-001`… (E-commerce, Site vitrine, Application web,
Blog / Média, Portfolio, Autre). Un nouveau cas créé en ligne reprend le préfixe et le numéro
suivant (`TC-ECOM-042`). Changer de projet (donc de catégorie) recharge le pack du projet
ciblé ; les retouches locales (renommage, drag & drop, créations/suppressions) vivent dans
l'état React et ne sont pas persistées.
- **Vue groupée** : en-tête de suite (nom, nombre de cas, actions `+` / crayon / corbeille
  au survol, chevron de repli), sous-en-tête `Cas de test` avec case « tout sélectionner »
  (état indéterminé géré), puis les lignes
  `poignée · case à cocher · ID bleu · titre · actions au survol`.
- **Renommer / supprimer une suite** depuis son en-tête : le crayon remplace le nom par un
  champ inline (sélectionné), `Entrée` / ✓ enregistre, `Échap` / ✕ annule ; un nom déjà
  pris est refusé (toast). Le nouveau nom se répercute sur l'arbre des suites, l'en-tête du
  groupe, le filtre actif et le fil d'ariane du tiroir. La corbeille supprime la suite **et
  ses cas de test** (sélection, tiroir et ligne de création associés fermés, toast avec le
  nombre de cas) ; le compteur de la suite et le total de l'arbre suivent.
- **Création inline** : le `+` d'une suite, l'arbre des suites ou « Créer un cas de
  test » insèrent une ligne en tête de la suite — **aucune modale** (le bouton principal
  de la toolbar est désormais **Déclenché**, dédié à la sélection).
  La ligne affiche d'abord l'**ID suivant** (`TC-ECOM-042` pour un projet e-commerce), puis le champ titre (focus
  automatique) et ✓ / ✕ ; `Entrée` crée le cas, `Échap` annule. Un brouillon déjà ouvert
  dans la même suite est conservé ; ouvrir un cas ou cliquer sur le crayon le referme.
- **Sélection multiple** : les cases de lignes et de suites sont indépendantes du tiroir ;
  la toolbar affiche `N sélectionnés · Tout désélectionner`, l'export porte sur la
  sélection et **Déclenché** reste grisé tant que rien n'est coché.
- **Actions de ligne au survol** (opacité 0 → 1, `pointer-events: none` au repos) :
  crayon = édition inline du titre, corbeille = suppression immédiate + toast.
  Les pastilles de statut et de priorité ne sont plus affichées dans le tableau.
- **Drag & drop** (HTML5 natif, style Jira/Atlassian) :
  - réordonnancement intra-suite (indicateur haut/bas bleu, toast `↕ TC-xxx reordered`) ;
  - déplacement inter-suites en déposant sur une ligne d'un autre groupe
    (toast `📦 TC-xxx moved to "…"`) ;
  - dépôt sur une **suite de l'arbre** pour y déplacer le cas ;
  - les **compteurs se mettent à jour** (suite source -1, suite cible +1, total inchangé).
- **Tiroir de détail** : fil d'ariane suite / ID, pagination précédent-suivant, titre,
  pastille de statut, onglets `Overview / Linked Tests` (les onglets *Attachments* et
  *History* ont été retirés),
  sections repliables *Description*, *Pre/Post-conditions*, *Steps* avec bascule
  **Classique ⇄ Gherkin**. Sous le tableau, **« + Ajouter une étape »** insère une ligne
  au numéro suivant avec deux champs (action, résultat attendu), validable par `Entrée`
  ou ✓ et annulable par `Échap`/✕ ; en mode Gherkin, l'ajout repasse en Classique.
  Chaque étape révèle **au survol** (ou au focus clavier) un **crayon** — édition inline
  action + résultat, `Entrée` enregistre, `Échap` annule — et une **corbeille** qui
  supprime l'étape immédiatement (renumérotation + toast).
- **Édition inline** (crayon au survol d'une ligne) : la ligne devient un champ titre
  pré-rempli et sélectionné (même gabarit que la création), avec ✓ / ✕ ; `Entrée`
  enregistre, `Échap` annule. **Aucune modale** : le titre et la description générée
  suivent, l'ID, la suite et les étapes restent inchangés (déplacement par drag & drop,
  étapes via le tiroir).

Les cas générés embarquent `description`, `preconditions`, `postconditions` et `steps`
(trois étapes plausibles dérivées du titre et de la suite) afin d'alimenter le tiroir.
Les compteurs de suites partent du **pack du type de site** (34 à 44 cas) puis suivent
les créations, suppressions de cas, les déplacements inter-suites, le renommage et la
suppression d'une suite.

## En-tête projet — sélecteur de projet

Le nom du projet dans le fil d'ariane est une **pastille bordée** (nom + chevron) qui ouvre
la liste des projets de l'organisation : section `Demo Organization` (`Demo Project`),
section de l'organisation de l'onboarding (projets créés via « New Project »), coche sur
le projet courant, puis **Tous les projets** vers `/projects`.

Changer de projet **conserve la page courante** (`/DemoProject/test-runs` →
`/AutreProjet/test-runs`, repli sur `/dashboard`), ferme le menu et met à jour la sidebar.
Le menu se ferme au clic extérieur et avec `Échap`.

## Responsive

- Sidebar : barre latérale fixe ≥ 768 px, tiroir avec fond assombri < 768 px.
- Table Test Runs : tableau ≥ 768 px, cartes empilées < 768 px.
- Test Cases : deux colonnes + panneau de suites **sticky** ≥ 1024 px ; empilé en dessous.
  Le panneau se replie depuis son en-tête ; la bascule « Suites » ne réapparaît dans la
  barre d'outils **que** lorsque le panneau est replié. Les badges statut/priorité ne
  s'affichent qu'à partir de 900 px, la grille de la modale passe de 5 à 2 colonnes sous 720 px.
- Dashboard : KPI 1 → 2 → 4 colonnes ; sections 1 → 2 → 3 colonnes.

## Mapping futur avec l'agent QA

Le `qa_result.json` du workflow (`.github/workflows/antigravity-qa.yml`) contient
`test_cases[]` avec `status` ∈ `passed | failed | blocked | skipped`, `evidence`,
`side_effects`, `summary`. Il se branche naturellement sur :

- la colonne **Résultats des tests** du tableau Test Runs (`src/data/runs.js` →
  `results.passed | failed`, les statuts `blocked` / `skipped` étant repliés sur
  `failed`) ;
- le **tiroir** (`RunDrawer.jsx`) : `evidence` alimente **Voir la preuve**,
  `summary` le message des cartes Réussi / Échoué et `side_effects` peut être
  ajouté sous la preuve ;
- la liste **Test Cases** (`src/data/casePacks.js`) pour l'inventaire des cas.

Les 4 cartes du Dashboard se branchent de la même façon sur la base de surveillance :
`src/data/sites.js` attend `sites(id, url, active, crawl_acknowledged, last_status,
load_time_ms, ssl_days_remaining, created_at)` et `page_checks(id, site_id, status, checked_at)`.

## Limites connues

- Les données sont **statiques** (capturées de la démo) ; il n'y a pas encore d'appels API.
  Les modifications faites par drag & drop vivent uniquement dans l'état React (perdues au
  rechargement).
- Les **données d'exemple sont réservées au projet `DemoProject`** : Dashboard, Test Runs et
  palette `Ctrl K` sont vides pour tout projet créé. Seuls les **cas de test générés par
  catégorie** restent disponibles dans tous les projets (fonctionnalité produit, pas un jeu
  de démonstration). Les projets créés sont conservés en `sessionStorage`.
- Les KPI du Dashboard sont calculés depuis un **jeu d'exemple** (`data/sites.js` :
  14 sites dont 12 actifs, 2 en incident, 2 certificats < 30 j, 12 842 / 13 318 checks UP) :
  c'est ce fichier qu'il faut remplacer par la vraie base. Les **libellés des cartes sont en
  français** comme demandé, alors que le reste de l'UI reste en anglais (TestDino) — un
  simple remplacement de chaînes suffit si on veut tout basculer.
- Le graphe sous les cartes reste le **Pass / Fail Trend des runs de test** (réplique exacte
  du site) ; il n'a pas été converti en « checks UP / DOWN par jour », qui serait pourtant
  la suite logique des nouvelles cartes.
- Le tiroir d'un run ne connaît pas le résultat détail par cas : les échecs du run sont
  répartis sur les cas de la suite (`testCases.filter(c => c.suite === run.suite)`), donc
  l'onglet **Échoué** peut lister moins de cas que le nombre d'échecs affiché sur le run.
- **recharts** alourdit le bundle (≈ 94 kB gzip) : c'est le prix de la réplique exacte du
  graphe *Pass / Fail Trend*. Un découpage de la route `/dashboard` (`React.lazy`) permettrait
  de ne le charger qu'à la visite du dashboard.
- Test Cases affiche un **pack généré de 34 à 44 cas** selon la catégorie du projet ; ces
  cas ne sont pas encore exécutés (le tiroir des runs s'appuie toujours sur l'ancien jeu de
  démonstration). Les compteurs de suites suivent les créations/suppressions de cas, les
  déplacements, le renommage et la suppression d'une suite.
- Le rendu a été vérifié à **1000 × 700 px** (layout empilé) : panneau de suites non sticky,
  badge masqué/affiché selon les media queries, 0 erreur console. Le rendu mobile étroit
  n'a pas pu être capturé (pas d'outil de redimensionnement) ; les media queries proviennent
  des breakpoints Tailwind et du clone validé.
- Le changelog de la cloche est un **instantané** (6 entrées `web-app`, du 12/10/2026 au
  23/09/2026) enregistré dans `src/data/changelog.js` : pas de fetch en direct vers
  `changelog-api.testdino.com`. Les entrées `cli`/`mcp` du flux réel ont été retirées.
- La page `/onboarding` a été reconstruite **depuis une capture d'écran** (thème sombre,
  1366 × 768) : `app.testdino.com/onboarding` redirige vers l'organisation courante dès
  qu'on en possède une, le DOM réel n'était donc pas inspectable. La mention légale sous le
  bouton est déduite de la capture et le logo est un substitut (icône `bird` de lucide au
  lieu de l'asset propriétaire).
- La page `/projects` est reconstruite depuis la capture de l'organisation gratuite **et** du
  DOM réel (cartes, modale, libellés, `data-testid`) relevé sur la sandbox de démo. La carte
  `Demo Project` n'apparaît pas dans l'organisation gratuite : elle appartient à
  `Demo Organization`. Les projets créés vivent dans l'état React (persisté en
  `sessionStorage`), les autres pages de la sidebar organisation sont des pages d'attente.
- Le clone contient **deux identités d'organisation**, comme le vrai compte : `Demo Organization`
  (sandbox en lecture seule, projet `Demo Project`) et le nom saisi à l'onboarding,
  `Agencys Organization` par défaut, qui porte les projets créés. Le menu du sélecteur
  d'organisation permet de passer de l'une à l'autre.
- La bannière « You're viewing sample data in a read-only sandbox. » du vrai site reste
  retirée, comme demandé.
- Le header ne reprend plus que la recherche, la cloche du changelog et le thème : les boutons
  *checklist de démarrage* (fusée + badge `3`) et *Help and support* du site réel ont été retirés.
  Le header organisation n'a, lui, pas de recherche (comme le vrai) et garde cloche + thème.
- L'onglet *Linked Tests* du tiroir affiche un état vide (seul *Overview* est implémenté,
  comme dans la référence) ; les onglets *Attachments* et *History* ont été retirés.

## Brancher la vraie base de surveillance

Tout se joue dans `src/data/sites.js`, dont les clés reprennent le schéma de la base :
`crawl_acknowledged`, `last_status`, `load_time_ms`, `ssl_days_remaining`, `created_at`.
Il suffit de remplacer les deux exports `sites` et `pageChecks30d` par les résultats de tes
requêtes ; les 4 cartes du Dashboard sont recalculées automatiquement.
