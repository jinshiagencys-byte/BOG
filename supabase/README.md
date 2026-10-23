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

## Exécution des runs — agent Antigravity

Le moteur d'exécution n'est **pas Playwright**. Les tests sont exécutés par
**Antigravity CLI** (`agy`) et son sous-agent navigateur natif `browser`, qui pilote Chrome
via Chrome DevTools (CDP). Aucun MCP `chrome-devtools` n'est configuré et Playwright n'est
plus utilisé par le workflow. L'agent principal coordonne les lots de cas, agrège les
observations du sous-agent et écrit `qa_result.json`.

Le modèle est servi par **OpenCode Zen** via son endpoint Gemini-compatible :

```text
GEMINI_API_KEY=$OPENCODE_API_KEY
GOOGLE_GEMINI_BASE_URL=https://opencode.ai/inference/google
modelProvider=gemini (dans ~/.gemini/antigravity-cli/settings.json)
```

Le workflow vérifie d'abord l'accès au modèle, puis lance `agy -p` avec
`--model gemini-3.8-flash-medium`. Le sous-agent `browser` est déclenché par la commande
`/browser` en tête du prompt. Si `OPENCODE_API_KEY` est absent, le workflow peut retomber
sur `GEMINI_API_KEY` avec l'endpoint Google standard.

Chaîne complète :

1. Le navigateur appelle l'Edge Function `start-run` avec le JWT utilisateur et les cas
   sélectionnés.
2. `start-run` appelle `create_run_manifest` en `service_role` : le manifeste contient les
   cas, leurs étapes numérotées (`n`), le plan, l'URL cible et un jeton éphémère.
3. `start-run` obtient un token d'installation GitHub App et déclenche le workflow
   `antigravity-qa.yml` avec `run_id`, `manifest_url` et `run_token`.
4. Le workflow récupère le manifeste, construit la section « PLAN DE TEST » du prompt à
   partir des cas, puis lance l'agent.
5. L'agent écrit `qa_result.json` : par cas, `status`, `severity`, `steps[].n`,
   `steps[].actual`, `steps[].evidence` (`url`, `http_status`, `console`, `network`,
   `screenshot`) ; au niveau global, `side_effects`.
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
  token d'installation GitHub App, déclenche `antigravity-qa.yml`, puis ne renvoie que
  `runId` au navigateur. Le jeton de run n'est jamais renvoyé au client.
- `supabase/functions/report-run/index.ts` : reçoit `x-run-token`, normalise
  `qa_result.json` (`test_cases` → `cases`, `id` → `code`, `n` conservé) et appelle
  `report_run` avec le `service_role`.
- `supabase/functions/run-manifest/index.ts` : sert le manifeste figé au workflow,
  authentifié par `x-run-token`.

Le workflow clone est `.github/workflows/antigravity-qa.yml` ; le prompt de l'agent est
dans `.github/qa/prompt.md` (le plan est injecté depuis le manifeste).

Secrets Edge configurés : `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (fournis par Supabase), et éventuellement
`ANTIGRAVITY_MODEL`. L'ancien nom `OPENCODE_MODEL` reste lu uniquement s'il contient déjà
un modèle `gemini-*`. Le `installation_id` est stocké par organisation dans
`github_integrations` ; aucune clé privée ni token GitHub n'est en base.
`github_integrations.workflow_file` vaut par défaut `antigravity-qa.yml`.

Côté GitHub Actions, le secret requis est `OPENCODE_API_KEY` (endpoint Gemini-compatible
d'OpenCode Zen). `GEMINI_API_KEY` reste un fallback optionnel pour l'endpoint Google
standard. Le secret `GITHUB_TOKEN` fourni par Actions n'est pas utilisé pour déclencher le
workflow : `start-run` passe par la GitHub App.

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
