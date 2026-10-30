# Antigravity + Chrome DevTools MCP — exécution QA sans Playwright

Deux workflows GitHub portent les cas QA :

| | `fastbrowse-qa.yml` | `antigravity-qa.yml` |
|---|---|---|
| Décideur | fastbrowse + Jev (LLM) | Antigravity (`agy`, LLM) |
| Surface | navigateur piloté par Jev | **Chrome DevTools MCP** (sous-agent navigateur `browser`) |
| Clé LLM | `OPENCODE_API_KEY` | TokenHarbor (`TOKENHARBOR_API_KEY`), sinon OpenCode |
| Assertions | runner fastbrowse + sonde `page-probe.mjs` | l'agent : action puis vérification (snapshot, réseau, console) |

Plus des workflows de validation (`webmcp-self-test.yml`, `real-site-qa.yml`, `odjafrik-audit.yml`).
**Aucun de ces workflows n'utilise Playwright.** Playwright a été retiré : le pilotage de Chrome
passe par `.github/qa/cdp-client.mjs`, un client Chrome DevTools Protocol minimal branché sur
le `WebSocket` natif de Node.

## Le client CDP (`.github/qa/cdp-client.mjs`)

- `launchBrowser()` démarre son propre Chrome headless (`--remote-debugging-port=0`).
- `connectBrowser(url)` se branche sur un Chrome déjà lancé, via son endpoint
  `webSocketDebuggerUrl`. En mode partagé, `close()` ne ferme que la connexion, jamais le
  Chrome du run.
- `CdpPage` expose `goto`, `reload`, `evaluate`, `callFunction`, `bodyText`,
  `applyStorageState` (cookies + `localStorage`), la capture des erreurs console et réseau, et
  la gestion des dialogues `window.confirm`.
- Aucune dépendance npm : uniquement le `WebSocket` global de Node (>= 22, les workflows
  utilisent Node 24).

## Antigravity décide, Chrome DevTools MCP exécute

`.github/workflows/antigravity-qa.yml` est l'architecture de référence : **c'est Antigravity
qui décide**, et il agit sur un Chrome réel via **Chrome DevTools MCP**. Le sous-agent
navigateur natif `browser` s'y branche avec `chrome-devtools-mcp --autoConnect` (le workflow
publie le `DevToolsActivePort` du Chrome du run dans `~/.config/google-chrome/`).

Les outils disponibles pour l'agent :

| Outil | Rôle |
|---|---|
| `navigate_page` | ouvre une URL et renvoie le titre et l'URL finale |
| `click`, `fill`, `hover`, `press_key`, `select_option` | agissent réellement sur la page |
| `take_snapshot` | arbre d'accessibilité + DOM réel (rôles, noms, valeurs) |
| `list_network_requests` / `get_network_request` | requêtes réellement émises et leur statut |
| `list_console_messages` / `get_console_message` | messages console réels |
| `evaluate_script`, `wait_for` | lecture calculée, attente d'un état |

**Chaque étape est « action puis vérification »** : l'agent agit, observe le résultat obtenu
(état changé, texte affiché, requête réseau, message console) et le cite comme preuve. Un
élément présent mais jamais actionné ne prouve rien — c'est précisément ce que la surface
WebMCP ne restituait pas.

Pourquoi cette bascule : le serveur MCP WebMCP exposait des outils à la page, mais l'agent ne
donnait pas à lire *ce qu'il avait fait* et *ce qu'il avait obtenu*. Chrome DevTools MCP
renvoie des observations structurées (snapshot, réseau, console) que l'agent restitue.

Le LLM passe par un proxy Gemini -> OpenAI Chat Completions neutre
(`.github/qa/llm-gemini-proxy.mjs`) : TokenHarbor par défaut (`TOKENHARBOR_API_KEY`), sinon
OpenCode Zen (`OPENCODE_API_KEY`), sinon les variables de dépôt `ANTIGRAVITY_LLM_BASE_URL` /
`ANTIGRAVITY_LLM_MODEL`.

### Ancienne surface WebMCP (retirée de l'exécution)

`.github/qa/webmcp-mcp-server.mjs` reste dans le dépôt (serveur MCP stdio, 4 outils) et
`.github/workflows/webmcp-self-test.yml` l'exerce sans LLM ni secret. **Il n'est plus déclaré
dans `antigravity-qa.yml`** : ce n'est plus une surface d'exécution, seulement une brique
historique conservée avec son auto-test.

## Session authentifiée en CI

Le workflow lit le secret de dépôt `WEBMCP_STORAGE_STATE` (JSON `storageState` :
`cookies` + `origins[].localStorage`) et l'injecte dans le **Chrome partagé** avant de lancer
l'agent, via `.github/qa/seed-storage-state.mjs` :

- les cookies sont posés avec `Network.setCookies` (portée navigateur : tous les onglets ouverts
  ensuite par l'agent en héritent) ;
- le `localStorage` de chaque origine est écrit en s'y rendant, pour que Chrome le persiste
  dans le profil (`--user-data-dir`) partagé par les onglets de l'agent.

Sans ce secret, aucun état n'est appliqué et les cas doivent être publics. Aucun jeton de
session n'est commité.

Créer le secret : GitHub → Settings → Secrets and variables → Actions → New repository
secret → `WEBMCP_STORAGE_STATE`.

## La sonde de page (fastbrowse)

`.github/qa/page-probe.mjs` reste la sonde indépendante du modèle utilisée par fastbrowse :
elle ouvre la page, attend le contenu attendu, recharge, mesure le temps d'affichage, relève la
console, vérifie les textes interdits et remonte les outils WebMCP éventuels. Elle a été
réécrite sur `cdp-client.mjs` : plus de Playwright, même contrat de retour (`matched`,
`reloadMatched`, `contentMs`, `httpStatus`, `negative`, `webmcp`...).

## Test sur un site réel (CI)

`.github/workflows/real-site-qa.yml` teste une **vraie URL publique** dans la CI : Chrome réel
+ `cdp-client.mjs`, sans Playwright, sans LLM, sans secret. Le script
`.github/qa/real-site-check.mjs` utilise un **User-Agent Chrome réel** (certains CDN/WAF
répondent 429 sur les scripts dès que l'UA contient « HeadlessChrome ») et vérifie HTTP, titre,
langue, texte visible, erreurs console, et surtout que chaque texte / sélecteur attendu est
**réellement visible** après défilement ; il écrit `report.json` et `screenshot.png` publiés en
artefacts.

Cible par défaut : `https://markhorusbj.com` (surchargeable par le champ `url` du dispatch).

## Audit fonctionnel d'un site réel

`.github/workflows/odjafrik-audit.yml` exécute `.github/qa/odjafrik-audit.mjs` depuis une IP
propre (le runner) : chaque scénario **agit puis vérifie** (routes profondes, accès direct à
`/auth/login`, connexion, recherche, listings, page produit, panier) et suit les appels d'API.
Un **429 est classé `blocked`, jamais `failed`**. Rapport JSON + Markdown en artefact.

## Lancer depuis l'application

`start-run` accepte :

- `executor: "fastbrowse"` (défaut) → `fastbrowse-qa.yml` ;
- `executor: "antigravity"` **ou** `executor: "webmcp"` → `antigravity-qa.yml`.

L'ancien exécuteur WebMCP/Playwright a été retiré : une demande `webmcp` part sur le workflow
Antigravity, désormais piloté par Chrome DevTools MCP. Le rapport est envoyé à `report-run`
avec `executor: "antigravity"`.

## Preuves

Le runner Playwright enregistrait des vidéos ; ce n'est **plus le cas** (le protocole CDP brut
n'a pas d'enregistreur vidéo). L'infrastructure de preuves reste en place côté application
(bucket privé `qa-evidence`, Edge Functions `upload-evidence` et `purge-evidence`, lecteur dans
le tiroir du run), mais aucun workflow ne la nourrit désormais : le workflow Antigravity archive
`qa_result.json`, `qa_agent.log`, le prompt et les journaux du proxy comme artefacts du run.

Un éventuel retour de preuves visuelles passerait par des captures CDP
(`Page.captureScreenshot`) plutôt que par une vidéo Playwright.

### Rétention des preuves

La purge tourne dans Supabase, pas dans la CI : `pg_cron` appelle chaque nuit à 03:17 UTC la
fonction `purge-evidence`, qui supprime les fichiers du bucket via l'API Storage.

| Cas | Conservation |
| --- | --- |
| Run réussi, bloqué ou ignoré | 30 jours |
| Run échoué | 90 jours |
| Objet orphelin (run supprimé) | 30 jours après le dépôt |

`qa_evidence_expired` liste les chemins échus ; `purge-evidence` les supprime par lots de 500
(3 lots maximum par passage, le reste part le lendemain).

Le secret partagé est stocké dans Vault (`evidence_purge_secret`), jamais dans le dépôt. La
tâche ne fait rien tant qu'il n'existe pas. Pour le poser ou le tourner :

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

## Verdicts

- `passed` : l'action a produit le résultat attendu, avec preuve.
- `failed` : résultat différent de l'attendu, avec preuve directe (texte, HTTP, console).
- `blocked` : navigateur indisponible, surface non exposée, erreur réseau ou quota API (429).
- `skipped` : étape non exécutée après un échec, ou fonctionnalité absente du site.

## Fichiers

- `.github/qa/cdp-client.mjs` — client CDP minimal, sans dépendance ;
- `.github/qa/prompt.md` — prompt de l'agent Antigravity (Chrome DevTools MCP) ;
- `.github/workflows/antigravity-qa.yml` — workflow Antigravity + Chrome DevTools MCP ;
- `.github/qa/seed-storage-state.mjs` — injection de la session authentifiée dans Chrome ;
- `.github/qa/webmcp-mcp-server.mjs` — ancien serveur MCP WebMCP (4 outils), hors exécution ;
- `.github/qa/webmcp-self-test.mjs` — client MCP de validation de ce serveur ;
- `.github/workflows/webmcp-self-test.yml` — workflow d'auto-test (ni LLM ni secret) ;
- `.github/qa/real-site-check.mjs` — test QA sur un site réel (visibilité, capture, rapport) ;
- `.github/workflows/real-site-qa.yml` — workflow de test sur un site réel (markhorusbj par défaut) ;
- `.github/qa/odjafrik-audit.mjs` / `.github/workflows/odjafrik-audit.yml` — audit fonctionnel (action → vérification) ;
- `.github/qa/page-probe.mjs` — sonde de page de fastbrowse (CDP brut) ;
- `.github/qa/llm-gemini-proxy.mjs` — proxy Gemini -> OpenAI neutre (TokenHarbor/OpenCode) ;
- `.github/qa/fixtures/webmcp-demo.html` — page instrumentée de démonstration ;
- `supabase/functions/upload-evidence/index.ts` — dépôt des preuves dans le bucket privé ;
- `supabase/functions/purge-evidence/index.ts` — suppression des preuves échues ;
- `supabase/migrations/20261028130000_v2_11_qa_evidence.sql` — bucket + policy de lecture ;
- `supabase/migrations/20261028140000_v2_12_evidence_retention.sql` — rétention et tâche cron.
