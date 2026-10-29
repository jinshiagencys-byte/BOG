# Antigravity + WebMCP — exécution QA sans Playwright

Deux workflows GitHub portent les cas QA :

| | `fastbrowse-qa.yml` | `antigravity-qa.yml` |
|---|---|---|
| Décideur | fastbrowse + Jev (LLM) | Antigravity (`agy`, LLM) |
| Surface | navigateur piloté par Jev | **outils WebMCP de la page**, repli sous-agent `browser` |
| Clé LLM | `OPENCODE_API_KEY` | TokenHarbor (`TOKENHARBOR_API_KEY`), sinon OpenCode |
| Assertions | runner fastbrowse + sonde `page-probe.mjs` | l'agent, outil par outil, via `webmcp_read_page` |

Plus un workflow de validation, `webmcp-self-test.yml`, qui exerce le serveur MCP sans LLM
ni secret. **Aucun de ces workflows n'utilise Playwright.** Playwright a été retiré : le
pilotage de Chrome passe par `.github/qa/cdp-client.mjs`, un client Chrome DevTools
Protocol minimal branché sur le `WebSocket` natif de Node.

## Le client CDP (`.github/qa/cdp-client.mjs`)

- `launchBrowser()` démarre son propre Chrome headless
  (`--enable-features=WebMCPTesting --remote-debugging-port=0`).
- `connectBrowser(url)` se branche sur un Chrome déjà lancé, via son endpoint
  `webSocketDebuggerUrl`.
- `CdpPage` expose `goto`, `reload`, `evaluate`, `callFunction`, `bodyText`, la capture des
  erreurs console et réseau, et la gestion des dialogues `window.confirm`.
- Aucune dépendance npm : uniquement le `WebSocket` global de Node (>= 22, les workflows
  utilisent Node 24).

Le flag `--enable-features=WebMCPTesting` est indispensable : sans lui,
`document.modelContext` n'existe pas dans Chrome stable.

## Antigravity décide, WebMCP exécute

`.github/workflows/antigravity-qa.yml` est l'architecture de référence : **c'est
Antigravity qui décide**, et les outils exposés par la page exécutent.

- `.github/qa/webmcp-mcp-server.mjs` est un serveur MCP local (stdio, JSON-RPC 2.0) déclaré
  dans `~/.gemini/config/mcp_config.json`. Il se branche sur le Chrome du run via
  `WEBMCP_CDP_URL` (le même Chrome que le sous-agent navigateur) et expose :

  | Outil MCP | Rôle |
  |---|---|
  | `webmcp_open` | ouvre une URL, renvoie l'URL, le titre et les outils WebMCP de la page |
  | `webmcp_list_tools` | liste les outils WebMCP (schéma, lecture seule / conséquentiel) |
  | `webmcp_call_tool` | exécute un outil ; une mutation n'est acceptée que sur `confirm: true` |
  | `webmcp_read_page` | défile la page et vérifie que chaque texte attendu est **réellement visible** |

- `webmcp_call_tool` refuse par défaut la confirmation `window.confirm` d'une mutation :
  sans `confirm: true`, l'outil renvoie `cancelled`. L'agent doit accepter explicitement,
  comme un utilisateur prudent.
- `webmcp_read_page` amène chaque motif à l'écran (`scrollIntoView`) avant de conclure :
  un texte présent dans le DOM mais jamais affiché ne compte pas. La recherche de motif
  couvre aussi `placeholder`, `aria-label`, `title` et `value` (le libellé d'un champ n'est
  pas dans son `textContent`, sinon une recherche ou un email serait un faux négatif), et
  ignore les balises non textuelles (`script`, `style`, …).
- Le serveur MCP fixe le **même viewport que la sonde fastbrowse** (1440x900, locale
  `fr-FR`, surchargeable par `WEBMCP_VIEWPORT`). Sans cela, Chrome headless démarre en
  ~780x493 : sous le point de rupture desktop de nombreux sites, les éléments réservés au
  desktop mesurent 0x0 et étaient déclarés « non visibles », en désaccord avec la sonde.
- `webmcpAvailable` (et `available` de `webmcp_list_tools`) ne vaut `true` que s'il existe
  des **outils utilisables** (`tools.length > 0`). Chrome expose en effet
  `document.modelContext` sur toute origine sécurisée réelle, même sans aucun outil : la
  simple présence de l'API est remontée à part via `webmcpApiPresent`, et l'absence d'outil
  s'accompagne d'un `reason` explicite pour éviter que l'agent croie le site pilotable.
- Une page qui n'expose **aucun** outil WebMCP retombe sur le sous-agent navigateur natif
  `browser` (Chrome DevTools/CDP) pour ce cas, ou en lecture seule via `webmcp_read_page`.
- Le LLM passe par un proxy Gemini -> OpenAI Chat Completions neutre
  (`.github/qa/llm-gemini-proxy.mjs`) : TokenHarbor par défaut (`TOKENHARBOR_API_KEY`),
  sinon OpenCode Zen (`OPENCODE_API_KEY`), sinon les variables de dépôt
  `ANTIGRAVITY_LLM_BASE_URL` / `ANTIGRAVITY_LLM_MODEL`.

## Auto-test du serveur MCP

`.github/workflows/webmcp-self-test.yml` se déclenche à la main **sans saisir d'entrée**
(ou sur un push touchant ses fichiers). Il lance Chrome, sert
`.github/qa/fixtures/webmcp-demo.html`, puis exécute `.github/qa/webmcp-self-test.mjs` :
un client MCP qui vérifie la découverte des outils, une lecture (`demo_add`), une mutation
confirmée, une mutation refusée faute de `confirm`, la visibilité réelle et le rejet d'un
outil absent. Il échoue en code 1 dès qu'un comportement change.

En local :

```sh
node .github/qa/webmcp-self-test.mjs                 # lance son propre Chrome
WEBMCP_CDP_URL=http://127.0.0.1:9333 node .github/qa/webmcp-self-test.mjs   # Chrome partagé
```

## La sonde de page (fastbrowse)

`.github/qa/page-probe.mjs` reste la sonde indépendante du modèle utilisée par fastbrowse :
elle ouvre la page, attend le contenu attendu, recharge, mesure le temps d'affichage,
relève la console, vérifie les textes interdits et remonte les outils WebMCP éventuels.
Elle a été réécrite sur `cdp-client.mjs` : plus de Playwright, même contrat de retour
(`matched`, `reloadMatched`, `contentMs`, `httpStatus`, `negative`, `webmcp`...).

## Test sur un site réel (CI)

`.github/workflows/real-site-qa.yml` teste une **vraie URL publique** dans la CI :
Chrome réel + `cdp-client.mjs`, sans Playwright, sans LLM, sans secret. Le script
`.github/qa/real-site-check.mjs` vérifie HTTP, titre, langue, texte visible, erreurs
console et surtout que chaque texte / sélecteur attendu est **réellement visible**
après défilement ; il écrit `report.json` et `screenshot.png` publiés en artefacts.

Cible par défaut : `https://markhorusbj.com` (surchargeable par le champ `url` du
dispatch). Ne pas confondre avec l'**auto-test du serveur MCP** (section suivante), qui
tourne, lui, sur une page de démonstration locale (`webmcp-demo.html` sur
`127.0.0.1:<port aléatoire>`) : deux étages distincts — le contrat du serveur MCP d'un
côté, le comportement d'un site réel de l'autre. Un site sans outil WebMCP n'est pas un
échec ici : c'est le repli lecture seule attendu.

## Lancer depuis l'application

`start-run` accepte :

- `executor: "fastbrowse"` (défaut) → `fastbrowse-qa.yml` ;
- `executor: "antigravity"` **ou** `executor: "webmcp"` → `antigravity-qa.yml`.

L'ancien exécuteur WebMCP/Playwright a été retiré : une demande `webmcp` part désormais sur
le workflow Antigravity. Le rapport est envoyé à `report-run` avec `executor: "antigravity"`.

## Session authentifiée en CI

Le workflow lit le secret de dépôt `WEBMCP_STORAGE_STATE` (JSON `storageState` :
`cookies` + `origins[].localStorage`) et l'expose au serveur MCP via
`WEBMCP_STORAGE_STATE`. Le serveur applique les cookies (`Network.setCookies`) et injecte
le `localStorage` (`Page.addScriptToEvaluateOnNewDocument`). Sans ce secret, aucun état
n'est appliqué et les cas doivent être publics. Aucun jeton de session n'est commité.

Créer le secret : GitHub → Settings → Secrets and variables → Actions → New repository
secret → `WEBMCP_STORAGE_STATE`.

## Preuves

Le runner Playwright enregistrait des vidéos ; ce n'est **plus le cas** (le protocole CDP
brut n'a pas d'enregistreur vidéo). L'infrastructure de preuves reste en place côté
application (bucket privé `qa-evidence`, Edge Functions `upload-evidence` et
`purge-evidence`, lecteur dans le tiroir du run), mais aucun workflow ne la nourrit
désormais : le workflow Antigravity archive `qa_result.json`, `qa_agent.log`, le prompt et
les journaux du proxy comme artefacts du run.

Un éventuel retour de preuves visuelles passerait par des captures CDP
(`Page.captureScreenshot`) plutôt que par une vidéo Playwright.

### Rétention des preuves

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

## Verdicts

- `passed` : toutes les assertions passent.
- `failed` : texte attendu absent, texte interdit présent, outil en erreur, mutation non
  refusée, ou confirmation manquante.
- `blocked` : navigateur indisponible, outil non exposé, erreur réseau ou quota API (429).
- `skipped` : étape non exécutée après un échec.

## Fichiers

- `.github/qa/cdp-client.mjs` — client CDP minimal, sans dépendance ;
- `.github/qa/webmcp-mcp-server.mjs` — serveur MCP WebMCP (4 outils) ;
- `.github/qa/webmcp-self-test.mjs` — client MCP de validation ;
- `.github/workflows/webmcp-self-test.yml` — workflow d'auto-test (ni LLM ni secret) ;
- `.github/qa/real-site-check.mjs` — test QA sur un site réel (visibilité, capture, rapport) ;
- `.github/workflows/real-site-qa.yml` — workflow de test sur un site réel (markhorusbj par défaut) ;
- `.github/qa/page-probe.mjs` — sonde de page de fastbrowse (CDP brut) ;
- `.github/qa/llm-gemini-proxy.mjs` — proxy Gemini -> OpenAI neutre (TokenHarbor/OpenCode) ;
- `.github/qa/prompt.md` — prompt de l'agent Antigravity (WebMCP d'abord) ;
- `.github/qa/fixtures/webmcp-demo.html` — page instrumentée de démonstration ;
- `supabase/functions/upload-evidence/index.ts` — dépôt des preuves dans le bucket privé ;
- `supabase/functions/purge-evidence/index.ts` — suppression des preuves échues ;
- `supabase/migrations/20261028130000_v2_11_qa_evidence.sql` — bucket + policy de lecture ;
- `supabase/migrations/20261028140000_v2_12_evidence_retention.sql` — rétention et tâche cron.
