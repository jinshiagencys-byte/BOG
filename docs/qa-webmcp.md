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
`waitForUrl`, `expectUrl`, `wait`. Les cibles acceptent `selector`, `placeholder`, `label`,
`text`, ou `role` + `name`. `expect` accepte `text` (regex), `failIfText` (regex) et `url`
(regex). Une étape en échec arrête le scénario et donne `failed / step-failed` ; une erreur
réseau ou un délai dépassé donne `blocked / network`.

Les sites qui hydratent leur interface en JavaScript demandent une attente après `goto` :
un `fill` immédiat peut remplir un champ avant que le gestionnaire `Enter` soit attaché.

Le jeu odjafrik vit dans `.github/qa/playwright-cases.json` et
`.github/qa/playwright-odjafrik-manifest.json` (recherche « Agonlin », fiche produit,
catalogue). Pour le lancer en CI : `manifest_file` = le manifeste, `cases_file` = le
catalogue.

## Verdicts

- `passed` : toutes les assertions passent.
- `failed` : texte attendu absent, texte interdit présent, tool en erreur, mutation non
  refusée, confirmation manquante ou refusée sans que le cas l'attende.
- `blocked` : navigateur indisponible, outil non exposé, erreur réseau ou cas non
  instrumenté.
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
- `.github/qa/playwright-cases.json` / `playwright-odjafrik-manifest.json` — jeu odjafrik.
