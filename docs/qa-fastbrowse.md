# fastbrowse — QA Odjafrik (exécuteur principal)

fastbrowse est l'exécuteur QA par défaut des runs GitHub d'Odjafrik. Il tourne en CLI avec
le Chrome du runner, sans Browser Use Cloud. Antigravity reste un fallback explicite ;
IronBee n'est plus déclenché.

## Une seule clé : `OPENCODE_API_KEY`

La même clé OpenCode Console alimente le LLM et Jev.

| Usage | Fournisseur | Modèle | Endpoint |
|---|---|---|---|
| LLM (plan/lecture) | OpenCode Console | `deepseek-v4.1-flash` | `https://opencode.ai/inference/openai/v1` |
| Jev | OpenCode Console | `jev-1.13` | `https://opencode.ai/inference/systemone` |

Aucun repli vers OpenRouter, Vercel AI Gateway ou Browser Use Cloud n'est configuré. Le
runner et le lanceur local retirent même ces clés de l'environnement pour éviter un repli
silencieux.

### En CI (GitHub Actions)

Le workflow `.github/workflows/fastbrowse-qa.yml` attend le secret de dépôt
`OPENCODE_API_KEY` :

1. GitHub → Settings → Secrets and variables → Actions → New repository secret.
2. Nom : `OPENCODE_API_KEY`. Valeur : la clé OpenCode Console.
3. Sans ce secret, un run contenant au moins un cas non WebMCP échoue avant tout appel
   payant avec un message explicite.

Le workflow recopie cette clé dans `TYPESAFE_API_KEY` et
`FASTBROWSE_LLM_API_KEY`. C'est la seule clé à recharger quand le solde est épuisé.

Un run composé uniquement de cas WebMCP (voir plus bas) n'appelle ni le LLM ni Jev : le
workflow ne construit pas fastbrowse et ne réclame pas `OPENCODE_API_KEY`.

### En local

Le clone est dans `$HOME/fastbrowse` (actuellement `/home/bill/fastbrowse`).

1. Acheter des crédits sur <https://opencode.ai/console>.
2. Créer une clé API OpenCode Console.
3. Ouvrir `$HOME/fastbrowse/.env` et coller la clé après `OPENCODE_API_KEY=`.
4. Ne rien mettre d'autre : le lanceur alimente automatiquement `TYPESAFE_API_KEY` et
   `FASTBROWSE_LLM_API_KEY` avec cette même clé.

## Vérifier sans lancer de navigateur

```sh
cd "$HOME/fastbrowse"
./scripts/odjafrik-fastbrowse.sh check
```

Sortie attendue : `Jev typesafe`, `LLM deepseek-v4.1-flash via local endpoint`, et
`Chrome /usr/bin/google-chrome`.

Si la clé manque, le script affiche où la coller et s'arrête sans rien dépenser.

## Lancer une tâche QA

Le lanceur ajoute `--local` si aucune option de navigateur n'est fournie.

```sh
cd "$HOME/fastbrowse"
./scripts/odjafrik-fastbrowse.sh \
  "Ouvre https://odjafrik.com/products et indique combien de produits sont affichés." \
  --start https://odjafrik.com/products \
  --max-steps 15 \
  --max-dollars 0.10
```

Pour un premier test après recharge, garder `--max-steps` et `--max-dollars` bas. Ne pas
relancer de batch QA complet avant que ce test unitaire passe.

## Ce que fait le run GitHub

1. `start-run` déclenche `fastbrowse-qa.yml` et transmet `run_id`, `manifest_url`,
   `run_token` et `report_url`.
2. Le workflow installe Chrome et `playwright-core@1.64.1`. Il ne clone fastbrowse au
   commit épinglé `e46c12a14e5cf5034e69eb7d5a21856eb0f0dc27` (version 0.6.0, absente de
   PyPI, donc installée depuis le dépôt Git) que si le manifeste contient au moins un
   cas non WebMCP.
3. `.github/qa/fastbrowse-runner.mjs` exécute chaque cas avec un objectif explicite
   (`.github/qa/fastbrowse-cases.json`), `--local`, `--max-steps 25`,
   `--max-dollars 0.10`, délai de 120 s par cas.
4. La sonde `.github/qa/page-probe.mjs` ouvre la même URL en parallèle, attend le texte
   attendu, recharge la page et mesure `contentMs` / `reloadContentMs`, l'HTTP et la
   console.
5. Le runner garde la propriété des assertions : fastbrowse ne valide pas un cas à lui
   seul. Les textes attendus, les textes interdits, l'URL, le seuil de 5 s et la console
   sont vérifiés par le runner et la sonde.
6. Le rapport est envoyé à `report-run` avec `executor: "fastbrowse"`. Le champ
   `engines` de `qa_result.json` indique combien de cas ont tourné en WebMCP et en
   fastbrowse.
7. La sonde lance Chrome avec `--enable-features=WebMCPTesting` et remonte les outils
   WebMCP exposés par la cible dans `probe.webmcp`.

Seuils des quatre cas principaux : `maxContentMs: 5000`, `maxWaitMs: 15000`.

## Cas WebMCP

Un cas instrumenté déclare l'outil exposé par la page dans
`.github/qa/fastbrowse-cases.json`. Le runner l'exécute avec
`.github/qa/webmcp-executor.mjs` dans un Chrome réel, puis applique ses propres
assertions. fastbrowse et la clé OpenCode ne sont pas sollicités.

```json
"TC-BOG-TEAM": {
  "url": "https://app.example.com/users",
  "label": "l’équipe de l’organisation active",
  "webmcp": {
    "tool": "bog_list_team",
    "args": {},
    "storageState": "/chemin/vers/storage-state.json",
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
- `storageState` (facultatif) : session Playwright pour les pages authentifiées.
- `confirm` : accepte la confirmation `window.confirm` d'une mutation. Sans cette
  option, la confirmation est refusée et le cas échoue en `confirmation-refused`.
- `expect.text` / `expect.failIfText` : expressions régulières appliquées au résultat de
  l'outil.
- `expect.url` : expression régulière appliquée à l'URL après exécution.
- `expect.dialog: true` : exige qu'une confirmation visible ait été demandée.

Verdicts : `passed` si toutes les assertions passent ; `failed` si un texte manque, si un
texte interdit apparaît, si l'outil échoue ou si la confirmation est refusée ; `blocked`
si la sonde est indisponible, si l'outil n'est pas exposé ou si le réseau échoue.

En CI, `storageState` doit désigner un fichier présent sur le runner. Aucun secret de
session n'est commité : le fichier est produit par une étape dédiée à partir d'un secret
GitHub, ou le cas reste public.


## Règles de verdict

- `passed` : le contenu attendu est affiché sous le seuil de 5 s, y compris après
  rechargement, et l'URL est conforme.
- `failed` : contenu absent, contenu trop lent, texte interdit (`Aucun produit trouvé`,
  `0 produits trouvés`) ou erreur console grave.
- `blocked` : erreur réseau (`429`, `ECONNRESET`, timeout), JSON fastbrowse absent ou
  preuve insuffisante. Un `429` dans une page déjà chargée n'est jamais rejoué ; les
  retries ne se déclenchent que sur timeout ou absence de JSON.
- `skipped` : étape non exécutée après un échec antérieur.

## État connu

- Les modèles gratuits OpenCode (`deepseek-v4.1-flash-free`, `jev-1.13-free`) ne sont pas
  utilisables ici : `FreeUsageLimitError` ou `Insufficient account funds`.
- OpenRouter n'est plus la voie prévue : son solde est insuffisant et le LLM y timeout.
- Le formulaire `.env` ne contient volontairement aucune clé réelle. Une ancienne
  configuration a été sauvegardée hors dépôt dans `$HOME/.config/fastbrowse/legacy.env`
  (mode 600).
- Les 40 cas génériques n'ont pas encore d'objectifs/assertions spécifiques ; seuls
  001–004, 101 et 103 sont cartographiés.
- `TC-ECOM-003` est un échec réel : `NG0600` dans `chunk-KQ7XRNI6.js`.
