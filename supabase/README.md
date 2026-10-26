# Supabase — intégration V2

## État

Les 6 migrations sont **appliquées** à la base `Monitoring Project`
(`ipnepkenbozwoslrhtcj`) : 228 modèles de cas / 684 étapes, 46 policies RLS, 7 sites
historiques conservés et aucun slug `demoproject`. Les Edge Functions `start-run`,
`run-manifest` et `report-run` sont déployées ; les secrets `GITHUB_APP_ID` et
`GITHUB_APP_PRIVATE_KEY` (PKCS#8) sont configurés. La GitHub App `BOG-QA` est installée
sur `jinshiagencys-byte/BOG`.

Un premier run de bout en bout a été validé avec l’ancien agent OpenCode + MCP
`chrome-devtools` : 7 cas exécutés (dont 2 découverts), résultats, étapes, preuves et
artefact GitHub ingérés par `report-run`. Le workflow utilise désormais **Antigravity CLI**
et son sous-agent navigateur natif, avec le modèle servi par OpenCode Zen.

La validation couvre aussi l'ingestion d'un `qa_result.json` d'agent : cas découvert,
cas du manifeste omis (repli `blocked`), preuves d'étape, `severity`, `side_effects` et
rejeu idempotent.

## Ordre d'application (déjà appliqué)

Les migrations ont été appliquées dans cet ordre, avec `supabase db push` :

1. `20261022120000_v2_01_orgs_projects.sql`
2. `20261022120100_v2_02_case_templates.sql`
3. `20261022120200_v2_03_create_project_with_cases.sql`
4. `20261022120300_v2_04_runs_github.sql`
5. `20261022120400_v2_05_rls_policies.sql`
6. `20261022120500_v2_06_report_run.sql`

Les migrations sont additives : elles ne suppriment aucune donnée métier. Elles
suppriment uniquement deux index redondants sur `crawl_reports`. Pour une nouvelle
instance, les tester d'abord sur une branche Supabase avant la production.

## Ce que font les migrations

| Migration | Effet |
|---|---|
| 01 | `organizations`, `organization_members`, helpers `is_org_member` / `has_org_role`, `slugify`, `create_organization` ; colonnes projet sur `sites` (`org_id`, `name`, `slug`, `category`, `description`, `updated_at`) ; slug unique insensible à la casse ; `DemoProject` réservé |
| 02 | `case_templates` + seed de **228 cas / 684 étapes** issus de `app/src/data/casePacks.js` |
| 03 | RPC `create_project_with_cases` (projet + plan v1 actif + copie des cas/étapes en une transaction), `update_project`, `delete_project` |
| 04 | Métadonnées de run (n° de run, GitHub, branche, env, CI, commit, auteur, PR, tags, durée, compteurs, manifeste, exécuteur, modèle, effets de bord), champs d'échec des résultats (`severity`, `precondition`, `evidence`), `github_integrations`, `ci_run_tokens`, `run_acknowledgements`, corrections d'index et de FK |
| 05 | Policies RLS par organisation + helpers d'accès ; lectures membres, écritures admin ; `ci_run_tokens` réservé au `service_role` |
| 06 | `create_run_manifest` (manifeste figé prêt pour l'agent + jeton éphémère), `attach_github_run`, `report_run` (ingestion idempotente de `qa_result.json`, cas découverts, cas omis bloqués, compteurs recalculés) — `service_role` uniquement |

## Vérifications après application

```sql
-- 228 modèles attendus
select count(*) from public.case_templates;

-- Les 7 sites historiques restent hors périmètre (org_id NULL)
select count(*) from public.sites where org_id is null;

-- Les policies doivent être présentes
select tablename, policyname
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- Aucun projet ne doit porter le slug de la démo
select id, slug from public.sites where lower(slug) = 'demoproject';
```

Les sites historiques (`org_id`, `name`, `slug` à `NULL`) ne sont **pas** des projets :
ils restent invisibles pour le clone et continuent d'alimenter le monitoring via le
`service_role`. Pour promouvoir l'un d'eux, renseigner `org_id`, `name` et `slug`
manuellement, puis créer un plan et copier les cas.

## Régénérer les packs

```bash
node supabase/scripts/generate-case-templates.mjs
```

Le script lit `app/src/data/casePacks.js` et réécrit
`20261022120100_v2_02_case_templates.sql`. Ne pas éditer ce fichier à la main.

## Exécution des runs — fastbrowse (principal)

Le chemin par défaut est **fastbrowse** en CLI avec le Chrome du runner. `start-run`
déclenche `.github/workflows/fastbrowse-qa.yml` ; le workflow installe Chrome, clone le
commit fastbrowse épinglé (`e46c12a14e5cf5034e69eb7d5a21856eb0f0dc27`), récupère le
manifeste puis exécute `.github/qa/fastbrowse-runner.mjs`.

Le runner ne fait pas confiance au verdict de l'agent : il possède les assertions. Un cas
n'est `passed` que si l'URL finale, les textes attendus, le délai d'affichage et la
politique console sont conformes. Une preuve de page peut donc valider un cas même si
fastbrowse termine `blocked` (par exemple quand Jev boucle sur « la page liste-t-elle des
produits ? »). Inversement, `Aucun produit trouvé` ou `0 produits trouvés` produit un
`failed`, pas un `blocked`.

- LLM : `deepseek-v4.1-flash` via `https://opencode.ai/inference/openai/v1`.
- Jev : `jev-1.13` via `https://opencode.ai/inference/systemone`.
- Une seule clé : le secret GitHub `OPENCODE_API_KEY`, recopiée dans
  `TYPESAFE_API_KEY` et `FASTBROWSE_LLM_API_KEY` par le workflow. Aucun repli vers
  OpenRouter, Vercel AI Gateway ou Browser Use Cloud.
- Les cas cartographiés sont dans `.github/qa/fastbrowse-cases.json` (objectifs, textes
  attendus, `probeUrl`, seuils `maxContentMs`/`maxWaitMs`). Les cas non cartographiés
  utilisent un objectif générique construit depuis leur titre et leurs étapes.
- La sonde `.github/qa/page-probe.mjs` ouvre la page en parallèle avec Playwright/Chrome,
  mesure le temps d'affichage, recharge la page et relève la console. Elle reste
  indépendante du modèle.
- Les erreurs réseau (`429`, `ECONNRESET`, timeouts) donnent `blocked` avec un retry
  borné uniquement quand fastbrowse n'a produit ni JSON ni verdict ; un `429` dans une
  page déjà chargée n'est jamais rejoué. Ces erreurs ne sont pas maquillées en échec
  produit.

Antigravity reste disponible en fallback explicite (`executor: "antigravity"` dans
`start-run`) et conserve le workflow `.github/workflows/antigravity-qa.yml`. IronBee n'est
plus déclenché.

## Exécution des runs — agent Antigravity (fallback)

Le moteur d'exécution n'est **pas Playwright**. Les tests sont exécutés par
**Antigravity CLI** (`agy`) et son sous-agent navigateur natif `browser`, qui pilote Chrome
via Chrome DevTools (CDP). Le workflow lance Chrome en mode headless avec
`--remote-debugging-port=0` et le profil `$HOME/.config/google-chrome` ; le sous-agent
s'y connecte via `--autoConnect`. Aucun MCP n'est configuré à la main et Playwright n'est
plus utilisé par le workflow. L'agent principal coordonne les lots de cas, agrège les
observations du sous-agent et écrit `qa_result.json`.

Antigravity ne sait parler qu'à un endpoint **Gemini-compatible**. Le workflow démarre
donc un proxy local, `.github/qa/opencode-gemini-proxy.mjs`, qui traduit les requêtes
Gemini (`streamGenerateContent`, outils, `functionResponse`) vers l'endpoint OpenAI Chat
Completions d'OpenCode Zen, puis retraduit le flux SSE (texte et `tool_calls`) en Gemini.
Antigravity ne reçoit qu'une clé factice et `GOOGLE_GEMINI_BASE_URL=http://127.0.0.1:8787`.
Le proxy applique le contrat d'identité du client OpenCode officiel (User-Agent,
en-têtes `x-opencode-*`, identifiants `ses_`/`msg_`, flux SSE et tools non vides). Sans
clé, il utilise le credential public `Bearer public` pour les modèles gratuits. Si
`OPENCODE_API_KEY` est fournie (secret GitHub Actions), elle est utilisée pour tous les
modèles, y compris gratuits, afin de rattacher le quota au compte authentifié.

Modèles OpenCode sélectionnables : `big-pickle` (défaut), `deepseek-v4.1-flash-free` et
`beam-free`. Le slug Gemini `gemini-3.8-flash-medium` n'est qu'un véhicule protocolaire :
le proxy le remplace par le modèle OpenCode choisi. Les requêtes de titre et de sécurité
d'Antigravity sont envoyées à `big-pickle`.

Le workflow démarre le proxy, vérifie l'accès au modèle via `/preflight`, puis lance
`agy -p`. Le sous-agent `browser` est déclenché par la commande `/browser` en tête du
prompt. Après chaque `invoke_subagent`, l'agent principal envoie immédiatement un
`send_message` au sous-agent pour maintenir la session active pendant son démarrage ;
sans cela, `agy -p` peut terminer avant que le navigateur ne soit connecté. Il n'y a plus
de repli sur `GEMINI_API_KEY` ni sur l'endpoint Google standard.

Chaîne complète :

1. Le navigateur appelle l'Edge Function `start-run` avec le JWT utilisateur et les cas
   sélectionnés.
2. `start-run` appelle `create_run_manifest` en `service_role` : le manifeste contient les
   cas, leurs étapes numérotées (`n`), le plan, l'URL cible et un jeton éphémère.
3. `start-run` obtient un token d'installation GitHub App et déclenche le workflow
   `fastbrowse-qa.yml` (ou `antigravity-qa.yml` si `executor: "antigravity"`) avec
   `run_id`, `manifest_url` et `run_token`.
4. Le workflow récupère le manifeste, construit un objectif par cas, lance fastbrowse en
   CLI, puis passe la page à la sonde Playwright indépendante.
5. fastbrowse et la sonde alimentent `qa_result.json` : par cas, `status`, `severity`,
   `steps[].n`, `steps[].actual`, `steps[].evidence` (`url`, `http_status`, `console`,
   `content_ms`, `product_count`, …) ; au niveau global, `side_effects`.
6. Le workflow normalise le rapport et l'envoie à `report-run` avec `x-run-token`.
7. `report-run` appelle `report_run` : résultats de cas et d'étapes, compteurs, preuves,
   `model`, `side_effects` et rapport brut sont enregistrés.

Règles d'ingestion :

- un cas découvert par l'agent (`discovered: true`, ex. `TC-101`) est ajouté au plan avec
  `source = 'discovered'` et devient consultable dans le projet ;
- un cas du manifeste absent du rapport est enregistré `blocked` (« non exécuté »), pour
  que le total du run corresponde aux cas sélectionnés ;
- un rejeu du même rapport est idempotent : pas de doublon de cas, d'étapes ni de preuves ;
- `severity` est normalisée en `P0`/`P1`/`P2` (la priorité du cas découvert en découle :
  `critical`/`high`/`medium`).

## Edge Functions

Fichiers déployés avec `supabase functions deploy` :

- `supabase/functions/start-run/index.ts` : vérifie le JWT utilisateur, charge
  `github_integrations`, appelle `create_run_manifest` avec le `service_role`, obtient un
  token d'installation GitHub App, déclenche `fastbrowse-qa.yml` par défaut, puis ne
  renvoie que `runId` au navigateur. Le jeton de run n'est jamais renvoyé au client.
- `supabase/functions/report-run/index.ts` : reçoit `x-run-token`, normalise
  `qa_result.json` (`test_cases` → `cases`, `id` → `code`, `n` conservé), respecte
  l'`executor` déclaré (`fastbrowse` ou `antigravity`) et appelle `report_run` avec le
  `service_role`.
- `supabase/functions/qa-credentials/index.ts` : remet la clé OpenRouter au workflow QA
  porteur d'un `x-run-token` valide. Conservée pour l'ancien chemin IronBee, elle n'est
  plus appelée par `fastbrowse-qa.yml`.
- `supabase/functions/run-manifest/index.ts` : sert le manifeste figé au workflow,
  authentifié par `x-run-token`.

Le workflow principal est `.github/workflows/fastbrowse-qa.yml` avec le runner
`.github/qa/fastbrowse-runner.mjs`, les objectifs `.github/qa/fastbrowse-cases.json` et la
sonde `.github/qa/page-probe.mjs`.
Le fallback Antigravity utilise `.github/workflows/antigravity-qa.yml` et
`.github/qa/prompt.md` (le plan est injecté depuis le manifeste).

Secrets Edge configurés : `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (fournis par Supabase), et
`ANTIGRAVITY_MODEL` (modèle OpenCode par défaut : `big-pickle`,
`deepseek-v4.1-flash-free` ou `beam-free`) pour le fallback. `OPENCODE_MODEL` reste
accepté comme alias. Le `installation_id` est stocké par organisation dans
`github_integrations` ; aucune clé privée ni token GitHub n'est en base.
`github_integrations.workflow_file` reste `antigravity-qa.yml` pour le fallback ;
`start-run` force `fastbrowse-qa.yml` par défaut.

Côté GitHub Actions, le secret `OPENCODE_API_KEY` est **obligatoire** pour fastbrowse :
le workflow s'arrête avec un message explicite s'il manque. Il alimente le LLM et Jev, et
le même secret sert de credential optionnel au fallback Antigravity. Le secret
`GITHUB_TOKEN` fourni par Actions n'est pas utilisé pour déclencher le workflow :
`start-run` passe par la GitHub App.

La clé privée téléchargée depuis GitHub est au format PKCS#1 (`BEGIN RSA PRIVATE KEY`).
`jose.importPKCS8` attend du PKCS#8 : la convertir avant de créer le secret Edge :

```bash
openssl pkcs8 -topk8 -nocrypt -in github-app.pem -out github-app-pkcs8.pem
```

Puis utiliser le contenu de `github-app-pkcs8.pem` pour `GITHUB_APP_PRIVATE_KEY`.

## Suivre un run GitHub

Le script `supabase/scripts/github-run-status.mjs` interroge l'API GitHub avec la GitHub App
et affiche le statut global, les jobs et les étapes :

```bash
node supabase/scripts/github-run-status.mjs <run_id>
node supabase/scripts/github-run-status.mjs <run_id> --watch
```

Il lit `supabase/.env.local`, ne révèle jamais la clé privée, et mappe les statuts GitHub
vers les statuts produit (`running`, `passed`, `failed`, `cancelled`). Le navigateur ne
doit jamais appeler GitHub directement : la clé privée reste côté serveur.

## Points de vigilance

- `service_role` contourne la RLS : ne jamais l'exposer au navigateur.
- Le jeton de run est stocké uniquement sous forme de hash, expire en 6 h et est lié à un
  seul `run_id`.
- Les statuts `blocked`/`skipped` restent en base ; l'interface ne montre que
  Réussi/Échoué, comme pour les runs.
- `test_runs.counter` de la démo correspond à `test_runs.run_number` en base.
- Les fréquences du formulaire sont en heures ; `sites.crawl_interval_minutes` et
  `notification_interval_minutes` sont en minutes (conversion × 60 dans les RPC).
