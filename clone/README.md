# Clone UI — TestDino « Test Runs »

Clone **fidèle et responsive** de la page *Test Runs* de `app.testdino.com`, obtenu par
observation live du dashboard réel (voir `../REVERSE-ENGINEERING.md`).

## Ouvrir

Le plus simple — double-clique `index.html` (tout est en chemins relatifs) :

```
clone/index.html
```

Ou via un petit serveur local (recommandé) :

```bash
cd /home/bill/TestDino-like
python3 -m http.server 8899
# → http://127.0.0.1:8899/clone/index.html
```

> Les polices (Geist) et les icônes (lucide) sont chargées via CDN — il faut une
> connexion réseau. Sans réseau, la mise en page et les couleurs restent correctes.

## Structure

```
clone/
├── index.html              # structure (sidebar, header, filtres, tableau)
└── assets/
    ├── css/
    │   ├── theme.css       # design tokens réels (clair + sombre)
    │   └── app.css         # composants + responsive
    └── js/
        ├── data.js         # 50 runs réels de la démo + environnements + filtres
        └── app.js          # rendu, filtres, recherche, thème, tiroir, pagination
```

## Fidélité (valeurs vérifiées par computed styles)

| Élément | Réel TestDino | Clone |
| --- | --- | --- |
| Fond `--background` | `hsl(0 0% 97.5%)` → `rgb(249,249,249)` | identique ✓ |
| Sidebar `--sidebar` | `hsl(0 0% 95.5%)` → `rgb(244,244,244)`, largeur 14rem | identique ✓ |
| Header | `h-12` = 48 px | 48 px ✓ |
| Badge *passed* | bg `rgb(241,249,245)`, texte `rgb(39,155,101)`, bordure `rgb(179,219,200)` | identique ✓ |
| Colonnes | Test Run · Commit · Branch & Environment · Test Results · AI Insights | identique ✓ |
| Nav sidebar | Overview / Test Results / Insights / Management / General | identique ✓ |
| Police | Geist + Geist Mono | identique ✓ |

Les **50 runs** viennent des données réelles de la démo (structure d'objet
`analyytics…/runs` reproduite). Les catégories **AI Insights** sont dérivées localement
(l'API `ai.testdino.com` ne les expose pas dans la liste) : à brancher côté back-end.

## Interactif

- **Sidebar** : repliable en rail d'icônes (≥768 px) ; tiroir + backdrop (<768 px).
- **Recherche** : bouton header ou **Ctrl/⌘ + K** → palette de commandes (filtre les runs).
- **Filtres** : période, statut, branche, tags, plus de filtres (environnement, CI).
- **Lignes** : clic → **tiroir de détail** (résultats en barres, commit, AI insights, tags).
- **Pagination** : 10/25/50 par page, « Page x of y · N total ».
- **Thème** : clair/sombre (bouton header, persistance `localStorage`, suit `prefers-color-scheme`).
- **Sync** : bouton d'actualisation avec animation.

## Responsive

| Largeur | Sidebar | Liste |
| --- | --- | --- |
| ≥768 px | fixe (repliable) | tableau |
| <768 px | tiroir | cartes empilées |

## Étapes suivantes possibles

1. Cloner de la même façon les autres vues : **run detail**, **Analytics**,
   **Test Explorer (flaky)**, **Pull Requests**, **Test Cases**, **Settings**.
2. Brancher le clone sur **tes données Antigravity** (`qa_result.json` : `test_cases[]`,
   statuts `passed/failed/blocked/skipped`, `evidence`, `side_effects`, `summary`) — mapping
   direct vers les colonnes « Test Results » et le tiroir de détail.
3. Remplacer le *relay* par un backend qui sert ces runs à la place de `TD_DATA`.
