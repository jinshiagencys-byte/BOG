# Playwright + WebMCP — exécuteur QA

Les cas instrumentés ne passent pas par fastbrowse. Le workflow
`.github/workflows/webmcp-qa.yml` utilise **Playwright** pour ouvrir Chrome, exécuter les
outils WebMCP déclarés par la page et vérifier le résultat.

Le même runner exécute aussi des **scénarios Playwright classiques** sur des sites non
instrumentés (odjafrik.com, par exemple) : mêmes vidéos, mêmes verdicts, mêmes preuves.

Aucun LLM, aucun Jev, aucune clé OpenCode : pas de budget à surveiller et pas de limite
de crédits.

## Pourquoi un workflow séparé

| | `fastbrowse-qa.yml` | `webmcp-qa.yml` |
|---|---|---|
| Pilotage | LLM + Jev, découverte du DOM | outils typés ou scénario déterministe |
| Clé requise | `OPENCODE_API_KEY` | aucune |
| Coût | budget par cas (`--max-dollars`) | temps CI uniquement |
| Assertions | runner fastbrowse | `webmcp-runner.mjs` |
| Cas | non instrumentés | `webmcp.tool` ou `playwright.steps` |

Un cas sans `webmcp.tool` ni `playwright.steps` reçu par `webmcp-qa.yml` est
`blocked / not-instrumented` : le workflow ne devine pas l'interface à la place de la page.

## Déclarer un cas

Le catalogue reste `.github/qa/fastbrowse-cases.json`.

```json
"TC-BOG-TEAM": {
  "url": "https://app.example.com/users",
  "label": "l’équipe de l’organisation active",
  "webmcp": {
    "tool": "bog_list_team",
    "args": {},
    "storageState": "${WEBMCP_STORAGE_STATE}",
    "expect": {
      "text": ["qa-bot@example.com", "owner"],
      "failIfText": ["ORG_FORBIDDEN"],
      "url": "/users"
    }
  }
}
```

- `tool` : nom exact de l'outil `document.modelContext`.
- `args` : arguments passés à l'outil.
- `storageState` (facultatif) : session Playwright pour les pages authentifiées. Les
  variables `${VAR}` sont remplacées depuis l'environnement.
- `confirm` : accepte la confirmation `window.confirm` d'une mutation. Sans cette
  option, la confirmation est refusée.
- `expect.text` / `expect.failIfText` : expressions régulières appliquées au résultat de
  l'outil.
- `expect.url` : expression régulière appliquée à l'URL après exécution.
- `expect.dialog: true` : exige qu'une confirmation visible ait été demandée.
- `expect.cancelled: true` : le cas passe seulement si la mutation est annulée. C'est la
  façon de tester qu'une action sensible reste protégée.

## Scénarios Playwright (sites réels)

Quand un site n'expose pas d'outils WebMCP, le cas décrit directement les actions. Le
catalogue `.github/qa/playwright-cases.json` suit le même format, avec `playwright` à la
place de `webmcp` :

```json
"TC-ODJ-SEARCH": {
  "url": "https://odjafrik.com",
  "label": "la recherche « Agonlin »",
  "playwright": {
    "steps": [
      { "action": "goto", "url": "https://odjafrik.com" },
      { "action": "waitForText", "text": "Vendre sur Odjafrik" },
      { "action": "wait", "ms": 2500 },
      { "action": "fill", "placeholder": "Rechercher des produits, fournisseurs...", "value": "Agonlin" },
      { "action": "press", "placeholder": "Rechercher des produits, fournisseurs...", "key": "Enter" },
      { "action": "waitForUrl", "pattern": "search=Agonlin" }
    ],
    "expect": {
      "url": "/products\\?search=Agonlin",
      "text": ["produits trouvés", "Agonlin", "FCFA"],
      "failIfText": ["Aucun produit"]
    }
  }
}
```

Actions disponibles : `goto`, `fill`, `press`, `click`, `waitForText`, `waitForSelector`,
`waitForUrl`, `expectUrl`, `wait`, `scroll`, `scrollThrough`, `selectOption`, `evaluate`.
Les cibles acceptent `selector`, `placeholder`, `label`, `text`, ou `role` + `name`.
`expect` accepte `text` (regex), `failIfText` (regex), `url` (regex) et `collected`
(valeurs relevées par `evaluate`, avec `minCount` et `ordered: "asc" | "desc"`). Une étape
en échec arrête le scénario et donne `failed / step-failed` ; une erreur réseau ou un
délai dépassé donne `blocked / network`.

Chaque texte attendu est **amené à l'écran** (`scrollIntoViewIfNeeded`) avant d'être
validé. Un texte présent dans le DOM mais jamais visible donne `failed / not-visible` :
c'est la différence entre « la page contient ce texte » et « l'utilisateur le voit ».
Les `<option>` sont vérifiées via leur `<select>`, et si un libellé existe en double
(menu mobile masqué), la première occurrence réellement visible est retenue.

Les sites qui hydratent leur interface en JavaScript demandent une attente après `goto` :
un `fill` immédiat peut remplir un champ avant que le gestionnaire `Enter` soit attaché.

Le jeu odjafrik vit dans `.github/qa/playwright-cases.json` et
`.github/qa/playwright-odjafrik-manifest.json` : recherche « Agonlin », recherche sans
résultat, fiche produit, catalogue, vendeurs, artisans, annonces. Pour le lancer en CI :
`manifest_file` = le manifeste, `cases_file` = le catalogue.

Un `429` renvoyé par l'API du site donne `blocked / rate-limited` : c'est un quota, pas un
défaut produit. Les autres erreurs HTTP restent des échecs. Le runner expose aussi
`playwright_http_errors` dans la preuve.

## Exploration du site et schéma de test

Un cas rédigé de façon vague (« vérifier la recherche ») ne dit pas quel produit,
quel prix ni quel libellé attendre. Avant d'exécuter, le runner explore donc le site
soumis une fois, puis réutilise le résultat pendant sept jours.

1. **Exploration déterministe** (`site-explorer.mjs`) : accueil, catalogue, tri,
   recherche (terme réel, état vide), fiche produit, annuaire des vendeurs, devise.
   Les faits relevés sont enregistrés dans `site_profiles` via `save-site-profile` et
   renvoyés par `run-manifest` quand ils ont moins de sept jours.
2. **Schéma LLM** (`case-planner.mjs`, facultatif) : le modèle reçoit ces faits et les
   cas, puis décide pour chacun le motif (`search`, `empty-search`, `product`,
   `catalog`, `catalog-sort`, `sellers`, `navigation`), les vérifications attendues,
   et les textes qui doivent être visibles (`mustSee`) ou jamais affichés
   (`mustNotSee`). Il ne fournit **ni sélecteur ni script**.
3. **Filtrage** : une assertion `mustSee` qui ne correspond à aucun fait observé est
   écartée ; un `mustNotSee` qui correspond à un fait observé aussi.
4. **Enrichissement** (`case-enricher.mjs`) : le motif produit un scénario Playwright
   déterministe avec les vraies données, plus des étapes lisibles pour l'écran. Une
   exploration fraîche remplace les enrichissements ; un profil réutilisé garde ceux
   qui ont été enregistrés avec lui.

Le LLM est donc un planificateur, pas un exécuteur : si sa réponse est vide ou
illisible, le runner garde le scénario déterministe et le run continue. Variables :
`WEBMCP_PLAN` (`auto` par défaut, `on`, `off`), `OPENCODE_API_KEY` +
`OPENCODE_MODEL`, ou `WEBMCP_PLAN_ENDPOINT` / `WEBMCP_PLAN_KEY` / `WEBMCP_PLAN_MODEL`.

L'exploration se déclenche quand le manifeste ne contient pas de profil frais et
qu'un cas n'a pas d'objectif écrit à la main. `WEBMCP_EXPLORE=force` l'impose,
`WEBMCP_EXPLORE=off` la désactive (utile pour les lots GitHub rapides).

## Verdicts

- `passed` : toutes les assertions passent.
- `failed` : texte attendu absent, texte interdit présent, tool en erreur, mutation non
  refusée, confirmation manquante ou refusée sans que le cas l'attende.
- `blocked` : navigateur indisponible, outil non exposé, erreur réseau, quota API (429) ou cas
  non instrumenté.
- `skipped` : étape non exécutée après un échec.

## Vidéos

Avec `WEBMCP_VIDEO_DIR`, chaque cas est enregistré par Playwright dans
`<dir>/<CODE>.webm`. Le chemin est ajouté à `qa_result.json` (`videos`) et dans
l'évidence de chaque étape (`video`). `WEBMCP_VIDEO_TAIL_MS` (700 ms par défaut) laisse le
résultat visible avant l'arrêt.

Le workflow écrit dans `qa-videos/` et archive le dossier avec `qa_result.json`. Les
vidéos sont une preuve complémentaire : leur absence ne change pas le verdict.

ffmpeg est nécessaire à `recordVideo`. Le workflow l'installe avec
`playwright-core/cli.js install ffmpeg` (pas de navigateur supplémentaire).

## Preuves visibles dans l'application

Quand `EVIDENCE_UPLOAD_URL` et `RUN_TOKEN` sont fournis (cas d'un run lancé par
`start-run`), le runner dépose chaque vidéo via `upload-evidence` :

```
qa-evidence/<org_id>/<run_id>/<CODE>.webm
```

- bucket **privé** ; aucune écriture possible depuis le navigateur ;
- `upload-evidence` vérifie le jeton éphémère du run et retrouve l'org par
  `test_runs → sites.org_id` ;
- l'application crée une URL signée (`getEvidenceUrl`) et affiche un lecteur dans
  « Voir la preuve » ;
- l'onglet **« Liens testés »** d'un cas liste ses exécutions réelles et ouvre le
  tiroir du run.

Un échec d'upload n'échoue jamais un cas : la vidéo reste dans l'artefact CI et le
verdict est inchangé. `start-run` transmet automatiquement `evidence_upload_url` pour
l'exécuteur `webmcp`.

Rétention : une vidéo pèse quelques centaines de Ko. À 1 Go de stockage gratuit, prévoir
une purge (par exemple ne garder que les runs échoués, ou 30 jours).

## Rétention des preuves

La purge tourne dans Supabase, pas dans la CI : `pg_cron` appelle chaque nuit à 03:17 UTC
la fonction `purge-evidence`, qui supprime les fichiers du bucket via l'API Storage.

| Cas | Conservation |
| --- | --- |
| Run réussi, bloqué ou ignoré | 30 jours |
| Run échoué | 90 jours |
| Objet orphelin (run supprimé) | 30 jours après le dépôt |

`qa_evidence_expired` liste les chemins échus ; `purge-evidence` les supprime par lots de
500 (3 lots maximum par passage, le reste part le lendemain).

Le secret partagé est stocké dans Vault (`evidence_purge_secret`), jamais dans le dépôt.
La tâche ne fait rien tant qu'il n'existe pas. Pour le poser ou le tourner :

```sh
# 1. secret d'appel de la fonction
supabase secrets set PURGE_SECRET=<valeur> --project-ref <ref>

# 2. copie pour pg_cron
select vault.create_secret('<valeur>', 'evidence_purge_secret', 'purge-evidence');
```

Contrôle manuel, sans rien supprimer :

```sh
curl -sS -X POST https://<ref>.supabase.co/functions/v1/purge-evidence \
  -H 'Content-Type: application/json' \
  -H 'x-purge-secret: <valeur>' \
  -d '{"dry_run": true}'
```

`run_id` limite la purge à une exécution et `retention_days` abaisse le seuil : pratique
pour vérifier la suppression réelle sur un run jetable.

## Lancer depuis l'application

`start-run` accepte `executor: "webmcp"` et déclenche `webmcp-qa.yml`. Le rapport est
envoyé à `report-run` avec `executor: "webmcp"`.

Le mode reste explicite : sans `executor: "webmcp"`, un run part sur fastbrowse.

## Session authentifiée en CI

Le workflow lit le secret de dépôt `WEBMCP_STORAGE_STATE` (JSON Playwright) et l'écrit
dans un fichier temporaire, exposé par `${WEBMCP_STORAGE_STATE}`. Sans ce secret, aucun
fichier n'est créé et les cas doivent être publics. Aucun jeton de session n'est commité.

Créer le secret : GitHub → Settings → Secrets and variables → Actions → New repository
secret → `WEBMCP_STORAGE_STATE`, valeur = contenu du `storageState` Playwright.

## Mode démonstration et CI

Sans `manifest_url` ni `manifest_file`, le workflow :

1. sert `.github/qa/fixtures/webmcp-demo.html` sur `127.0.0.1:4173` ;
2. exécute `.github/qa/webmcp-demo-manifest.json` avec
   `.github/qa/webmcp-demo-cases.json` ;
3. archive `qa_result.json` et les vidéos de `qa-videos/`.

Avec `manifest_file` (et `cases_file`), le workflow lit un manifeste du dépôt et lance
les cas directement sur leurs URLs, sans Supabase. C'est le mode des scénarios réels :

```
manifest_file: .github/qa/playwright-odjafrik-manifest.json
cases_file:    .github/qa/playwright-cases.json
```

La page de démonstration enregistre trois outils : `demo_echo`, `demo_add` et
`demo_set_status` (mutation avec `window.confirm`). Les quatre cas vérifient une lecture,
un calcul, une mutation confirmée et un refus sans confirmation.

Le workflow se déclenche aussi sur un push vers `main` qui touche ces fichiers : c'est le
smoke test de l'architecture, sans secret ni coût de modèle.

## En local

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory .github/qa/fixtures &
WEBMCP_PROBE_DIR=/home/bill/jev-browser-skill \
WEBMCP_DEMO_MANIFEST=$PWD/.github/qa/webmcp-demo-manifest.json \
WEBMCP_CASES=$PWD/.github/qa/webmcp-demo-cases.json \
QA_OUTPUT=/tmp/qa-result-webmcp.json \
node .github/qa/webmcp-runner.mjs
```

`WEBMCP_PROBE_DIR` doit contenir `playwright-core` (ou `NODE_PATH` doit le fournir).

Scénarios réels, avec vidéos :

```sh
WEBMCP_PROBE_DIR=/home/bill/jev-browser-skill \
RUN_MANIFEST=$PWD/.github/qa/playwright-odjafrik-manifest.json \
WEBMCP_CASES=$PWD/.github/qa/playwright-cases.json \
WEBMCP_VIDEO_DIR=/tmp/odjafrik-videos \
QA_OUTPUT=/tmp/qa-result-odjafrik.json \
node .github/qa/webmcp-runner.mjs
```

## Fichiers

- `.github/qa/webmcp-executor.mjs` — ouvre Chrome, découvre et exécute un outil ;
- `.github/qa/playwright-executor.mjs` — rejoue un scénario d'actions déterministes ;
- `.github/qa/webmcp-runner.mjs` — manifeste, assertions, étapes, rapport, vidéos ;
- `.github/workflows/webmcp-qa.yml` — workflow Playwright ;
- `.github/qa/fixtures/webmcp-demo.html` — page instrumentée de démonstration ;
- `.github/qa/webmcp-demo-cases.json` / `webmcp-demo-manifest.json` — jeu de démo ;
- `.github/qa/playwright-cases.json` / `playwright-odjafrik-manifest.json` — jeu odjafrik ;
- `supabase/functions/upload-evidence/index.ts` — dépôt des vidéos dans le bucket privé ;
- `supabase/functions/purge-evidence/index.ts` — suppression des preuves échues ;
- `supabase/migrations/20261028130000_v2_11_qa_evidence.sql` — bucket + policy de lecture ;
- `supabase/migrations/20261028140000_v2_12_evidence_retention.sql` — rétention et tâche cron.
