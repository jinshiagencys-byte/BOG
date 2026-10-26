# fastbrowse — QA locale Odjafrik (stand by)

fastbrowse est le navigateur QA de secours/rapide pour Odjafrik. Il tourne en CLI avec le Chrome local, sans Browser Use Cloud. Il reste en **stand by** tant que la clé OpenCode payante n'est pas rechargée.

## Une seule clé à renseigner

Le clone est dans `$HOME/fastbrowse` (actuellement `/home/bill/fastbrowse`).

1. Acheter des crédits sur <https://opencode.ai/console>.
2. Créer une clé API OpenCode Console.
3. Ouvrir `$HOME/fastbrowse/.env` et coller la clé après `OPENCODE_API_KEY=`.
4. Ne rien mettre d'autre : le lanceur alimente automatiquement `TYPESAFE_API_KEY` et `FASTBROWSE_LLM_API_KEY` avec cette même clé.

La configuration utilise :

| Usage | Fournisseur | Modèle | Endpoint |
|---|---|---|---|
| LLM (plan/lecture) | OpenCode Console | `deepseek-v4.1-flash` | `https://opencode.ai/inference/openai/v1` |
| Jev | OpenCode Console | `jev-1.13` | `https://opencode.ai/inference/systemone` |

Aucun repli vers OpenRouter, Vercel AI Gateway ou Browser Use Cloud n'est configuré. Le lanceur retire même ces clés de l'environnement pour éviter un repli silencieux.

## Vérifier sans lancer de navigateur

```sh
cd "$HOME/fastbrowse"
./scripts/odjafrik-fastbrowse.sh check
```

Sortie attendue : `Jev typesafe`, `LLM deepseek-v4.1-flash via local endpoint`, et `Chrome /usr/bin/google-chrome`.

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

Pour un premier test après recharge, garder `--max-steps` et `--max-dollars` bas. Ne pas relancer de batch QA complet avant que ce test unitaire passe.

## État connu

- Les modèles gratuits OpenCode (`deepseek-v4.1-flash-free`, `jev-1.13-free`) ne sont pas utilisables ici : `FreeUsageLimitError` ou `Insufficient account funds`.
- OpenRouter n'est plus la voie prévue : son solde est insuffisant et le LLM y timeout.
- Le formulaire `.env` ne contient volontairement aucune clé réelle. Une ancienne configuration a été sauvegardée hors dépôt dans `$HOME/.config/fastbrowse/legacy.env` (mode 600).
- fastbrowse n'est pas encore branché dans le workflow CI Odjafrik. IronBee reste l'exécuteur QA actuel.
